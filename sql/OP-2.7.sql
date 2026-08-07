-- =============================================================================
-- OP-2.7 · Escrita da RM: as três RPCs do livro + unicidade do número
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- ESCOPO: 3 funções novas + 1 índice único parcial em `op_requisicoes`.
-- Nenhuma tabela, coluna, policy, cron ou secret é criado ou alterado.
-- Não há DML: a tabela tem 0 linhas hoje.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 NENHUMA POLICY DE INSERT/UPDATE PARA `authenticated` — DE PROPÓSITO
-- ─────────────────────────────────────────────────────────────────────────────
-- `op_requisicoes` continua com UMA policy, de SELECT. Toda escrita passa por
-- estas RPCs `SECURITY DEFINER`, gateadas por `producao.rm.create`.
--
-- Abrir a tabela a `authenticated` seria a classe do BL-5: gate bonito no
-- frontend e tabela aberta no servidor — qualquer um dos 100+ usuários grava
-- pelo console do navegador. É também o padrão que `requisicoesService.ts`
-- ainda usa em Suprimentos (`.upsert()` direto) e que o módulo de Projetos
-- ABANDONOU no achado A-2, quando descobriu que o `.upsert()` era barrado pela
-- RLS para não-admin: o pedido entrava no ERP e o Hub devolvia `success: true`
-- sem registrar nada.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRATO DE RETORNO
-- ─────────────────────────────────────────────────────────────────────────────
-- As três devolvem o envelope que `chamarRpc()` (src/services/projetosService.ts)
-- já normaliza:
--     sucesso → { "success": true,  ...campos úteis }
--     falha   → { "success": false, "mensagem": "...", "erro_codigo": "..." }
--
-- Falha de negócio NÃO usa `raise`: o front distingue os dois modos, mas o
-- envelope dá mensagem em português direto para o toast, sem depender de
-- tradução de `SQLSTATE`. Códigos usados:
--     sem_permissao · sem_sessao · op_nao_encontrada · op_status_invalido
--     nao_encontrada · status_invalido · numero_divergente · sem_numero
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O CICLO QUE ESTAS TRÊS SUSTENTAM (§10.16, medido em campo)
-- ─────────────────────────────────────────────────────────────────────────────
--   op_rm_criar            → 'pendente'    (o livro nasce ANTES do POST, §10.14)
--   ├ passo 1  SaveReqMat Insert  → op_rm_marcar_enviado    → 'enviado'
--   ├ passo 2  SaveReqMat Update  (TipoAtendimento: Manual)
--   └ passo 3  ReqMat/Load        → op_rm_marcar_confirmado → 'confirmado'
--
-- 🔴 O passo 2 NÃO é opcional. RM criada por API nasce `Automático`, e
--    `Automático` nunca atende. Medido no universo de produção em 07/08/2026
--    (n=287): **Automático = 16, TODAS Abertas; Manual = 271, ZERO aberta.**
--    Em 05/08 era 13/266 — três RMs nasceram mortas em dois dias, uma delas a
--    `0000002283`, criada pela MARIA.EDUARDA na TELA do Alvo (ou seja: o defeito
--    não é da API, é do campo).
--
-- ⚠ O estado `enviado` com `erro_mensagem` preenchido é LEGÍTIMO e é o mais
--   perigoso: significa Insert OK + Update falho — a RM existe no ERP e está
--   morta. A tela usa exatamente essa assinatura (`status_envio = 'enviado'`
--   AND `numero_reqmat IS NOT NULL`) para oferecer "Concluir envio (passo 2)"
--   em vez de "criar de novo", que duplicaria a RM.
-- =============================================================================


-- =============================================================================
-- 1) ÍNDICE ÚNICO PARCIAL — uma RM do Alvo, uma linha no livro
-- =============================================================================
-- O `idx_op_requisicoes_reqmat` existente é NÃO-único: duplo clique ou retry
-- cego criam duas linhas para o mesmo número. Este barra no banco.
--
-- ⚠ Parcial (`where numero_reqmat is not null`) porque `pendente` nasce SEM
--   número — várias linhas pendentes coexistem legitimamente enquanto o POST
--   não volta.
create unique index if not exists ux_op_requisicoes_reqmat
  on public.op_requisicoes (codigo_empresa_filial, numero_reqmat)
  where numero_reqmat is not null;


-- =============================================================================
-- 2) `op_rm_criar` — o livro nasce ANTES do POST
-- =============================================================================
-- Por que antes (§10.14): se a rede cair depois de o Alvo gravar, existe RM
-- órfã no ERP e nada no Hub. A linha pré-gravada é o único rastro para
-- reconciliar — e o `payload_enviado` é a única cópia do que foi pedido até o
-- sync chegar (não há tabela de itens do livro, por desenho).
create or replace function public.op_rm_criar(p_op_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_numero text;
  v_id     uuid;
begin
  if not public._user_has_perm('producao.rm.create') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para criar Requisição de Material (producao.rm.create).');
  end if;
  if v_uid is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_sessao',
      'mensagem', 'Sessão sem auth.uid() — faça login novamente.');
  end if;

  select status, numero into v_status, v_numero
    from public.op_ordens where id = p_op_id;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'op_nao_encontrada',
      'mensagem', 'Ordem de Produção não encontrada.');
  end if;

  -- Regra fundadora da Fase 2 (§10.1): RM nasce de uma OP viva. Revalidada
  -- AQUI e não só na tela — defesa em profundidade, no molde do gate de fase
  -- do L7-B de Projetos.
  if v_status not in ('ABERTA', 'EM_ANDAMENTO') then
    return jsonb_build_object('success', false, 'erro_codigo', 'op_status_invalido',
      'mensagem', format('A OP %s está %s. Só OP ABERTA ou EM_ANDAMENTO recebe requisição de material.',
                         v_numero, v_status));
  end if;

  insert into public.op_requisicoes (op_id, status_envio, criado_por, payload_enviado)
  values (p_op_id, 'pendente', v_uid, p_payload)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'op_numero', v_numero);
end $function$;


-- =============================================================================
-- 3) `op_rm_marcar_enviado` — resultado do passo 1 (e do retry do passo 2)
-- =============================================================================
-- O status é decidido pelo NÚMERO, não pelo erro:
--   · com número → 'enviado' (a RM existe no ERP), e `p_erro` vai junto quando
--     o passo 2 falhou depois — é o estado perigoso, e precisa ficar visível;
--   · sem número → 'erro' (nada foi criado lá).
create or replace function public.op_rm_marcar_enviado(
  p_id       uuid,
  p_numero   text,
  p_resposta jsonb default null,
  p_erro     text  default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_atual  record;
  v_numero text := nullif(trim(coalesce(p_numero, '')), '');
begin
  if not public._user_has_perm('producao.rm.create') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para registrar o envio (producao.rm.create).');
  end if;

  select id, status_envio, numero_reqmat into v_atual
    from public.op_requisicoes where id = p_id;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrada',
      'mensagem', 'Requisição não encontrada no livro do Hub.');
  end if;

  -- Já fechada: não se reabre. Evita que um retry atrasado desfaça a
  -- confirmação de uma RM que já está `Manual` no Alvo.
  if v_atual.status_envio = 'confirmado' then
    return jsonb_build_object('success', false, 'erro_codigo', 'status_invalido',
      'mensagem', 'Esta requisição já está confirmada — nada a registrar.');
  end if;

  -- Anti-duplicata: se a linha já tem número e chega OUTRO, alguém criou uma
  -- segunda RM no ERP para o mesmo registro do livro. Recusar aqui deixa o
  -- rastro em vez de sobrescrever o número antigo e perdê-lo.
  if v_atual.numero_reqmat is not null and v_numero is not null
     and v_numero <> v_atual.numero_reqmat then
    return jsonb_build_object('success', false, 'erro_codigo', 'numero_divergente',
      'mensagem', format('Esta requisição já está vinculada à RM %s no ERP; recebido %s. Confira no Alvo antes de prosseguir — pode haver RM duplicada.',
                         v_atual.numero_reqmat, v_numero));
  end if;

  if v_numero is not null then
    update public.op_requisicoes
       set status_envio   = 'enviado',
           numero_reqmat  = v_numero,
           enviado_em     = coalesce(enviado_em, now()),
           resposta_alvo  = coalesce(p_resposta, resposta_alvo),
           erro_mensagem  = p_erro
     where id = p_id;

    return jsonb_build_object('success', true, 'status_envio', 'enviado',
      'numero_reqmat', v_numero, 'com_erro', p_erro is not null);
  end if;

  update public.op_requisicoes
     set status_envio  = 'erro',
         resposta_alvo = coalesce(p_resposta, resposta_alvo),
         erro_mensagem = coalesce(p_erro, 'Falha no envio, sem mensagem do ERP.')
   where id = p_id;

  return jsonb_build_object('success', true, 'status_envio', 'erro');
end $function$;


-- =============================================================================
-- 4) `op_rm_marcar_confirmado` — resultado do passo 3
-- =============================================================================
-- Só de 'enviado', e só com número. Confirmar sem `Load` que devolveu
-- `TipoAtendimento = "Manual"` seria carimbar de viva uma RM possivelmente
-- morta — o front só chama esta função depois de ler o campo.
create or replace function public.op_rm_marcar_confirmado(p_id uuid, p_resposta jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_atual record;
begin
  if not public._user_has_perm('producao.rm.create') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para confirmar o envio (producao.rm.create).');
  end if;

  select id, status_envio, numero_reqmat into v_atual
    from public.op_requisicoes where id = p_id;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrada',
      'mensagem', 'Requisição não encontrada no livro do Hub.');
  end if;

  if v_atual.status_envio <> 'enviado' then
    return jsonb_build_object('success', false, 'erro_codigo', 'status_invalido',
      'mensagem', format('Só se confirma requisição em "enviado" — esta está em "%s".', v_atual.status_envio));
  end if;

  if v_atual.numero_reqmat is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_numero',
      'mensagem', 'Requisição sem número de RM — não há o que confirmar no ERP.');
  end if;

  update public.op_requisicoes
     set status_envio   = 'confirmado',
         confirmado_em  = now(),
         resposta_alvo  = coalesce(p_resposta, resposta_alvo),
         erro_mensagem  = null            -- deu certo: o erro do passo 2 saiu de cena
   where id = p_id;

  return jsonb_build_object('success', true, 'status_envio', 'confirmado',
    'numero_reqmat', v_atual.numero_reqmat);
end $function$;


-- =============================================================================
-- 5) GRANTS — execute só para `authenticated`; `anon` fica de fora
-- =============================================================================
-- `revoke ... from public` primeiro porque função nova nasce com EXECUTE para
-- PUBLIC no Postgres, e PUBLIC inclui `anon`.
revoke execute on function public.op_rm_criar(uuid, jsonb) from public;
revoke execute on function public.op_rm_marcar_enviado(uuid, text, jsonb, text) from public;
revoke execute on function public.op_rm_marcar_confirmado(uuid, jsonb) from public;

grant execute on function public.op_rm_criar(uuid, jsonb) to authenticated;
grant execute on function public.op_rm_marcar_enviado(uuid, text, jsonb, text) to authenticated;
grant execute on function public.op_rm_marcar_confirmado(uuid, jsonb) to authenticated;


-- =============================================================================
-- 6) PostgREST — recarregar o cache de schema
-- =============================================================================
-- Sem isto, `supabase.rpc('op_rm_criar', …)` responde 404 até o próximo reload.
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =============================================================================
-- a) as três funções, com os atributos certos:
--
--   select proname, prosecdef as security_definer, proconfig as search_path,
--          pg_get_userbyid(proowner) as owner,
--          has_function_privilege('anon',          oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth
--     from pg_proc
--    where pronamespace = 'public'::regnamespace and proname like 'op\_rm\_%'
--    order by proname;
--
--   Esperado: 3 linhas, security_definer = t, search_path = {search_path=public},
--   owner = postgres, anon = FALSE, auth = TRUE.
--
-- b) o índice único existe e é ÚNICO e PARCIAL:
--
--   select indexname, indexdef from pg_indexes
--    where schemaname='public' and tablename='op_requisicoes'
--      and indexname='ux_op_requisicoes_reqmat';
--
--   Esperado: `CREATE UNIQUE INDEX … WHERE (numero_reqmat IS NOT NULL)`.
--   ⚠ Se a criação FALHAR com "could not create unique index", já existem
--     duplicatas. Achar antes de insistir:
--       select codigo_empresa_filial, numero_reqmat, count(*)
--         from public.op_requisicoes where numero_reqmat is not null
--        group by 1,2 having count(*) > 1;
--     (Hoje a tabela tem 0 linhas, então isto não deve ocorrer.)
--
-- c) 🔴 A TABELA CONTINUA SEM ESCRITA DIRETA — é o ponto do arquivo:
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.op_requisicoes'::regclass;
--
--   Esperado: EXATAMENTE 1 linha, `op_requisicoes_select` / `r`.
--   Qualquer policy de `a` (insert), `w` (update) ou `d` (delete) aqui
--   significa que algo além deste arquivo foi aplicado.
--
-- d) o gate responde (rodar no APP, logado — o SQL Editor roda sem
--    autenticação e `auth.uid()` volta null, então ali o retorno é
--    'sem_permissao'/'sem_sessao' mesmo para o admin. Isso é o esperado,
--    não é defeito — é a armadilha registrada no CLAUDE.md):
--
--   select public.op_rm_criar('00000000-0000-0000-0000-000000000000'::uuid, '{}'::jsonb);
--
--   No SQL Editor: {"success": false, "erro_codigo": "sem_permissao", …}
--
-- e) fim a fim, na TELA (é a validação que vale): criar uma RM na OP 2026-0503
--    e conferir as três linhas do ciclo:
--
--   select r.status_envio, r.numero_reqmat, r.enviado_em, r.confirmado_em,
--          r.erro_mensagem, o.numero as op, p.full_name as criou
--     from public.op_requisicoes r
--     join public.op_ordens o on o.id = r.op_id
--     left join public.profiles p on p.user_id = r.criado_por
--    order by r.criado_em desc limit 5;
--
--   Esperado no caminho feliz: status_envio = 'confirmado', numero_reqmat
--   preenchido, os dois carimbos, erro_mensagem null.
--
--   E no ERP, a prova que importa:
--
--   select numero, origem, tipo_atendimento, status, codigo_funcionario, codigo_usuario
--     from public.op_reqmat where numero = '<o número criado>';
--
--   Esperado APÓS o próximo sync (≤3h): origem = 'Importação' (a métrica de
--   vazamento da §10.7), tipo_atendimento = 'Manual' (viva, não morta),
--   codigo_funcionario = o do perfil de quem criou.
--   ⚠ `codigo_usuario` virá da CONTA DE SERVIÇO do gateway, não de quem
--     clicou — o `SaveReqMat` não tem campo de usuário no corpo. Ver §10.24.


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Reverte 100% do arquivo. Seguro a qualquer momento: as funções não são
-- referenciadas por trigger, view ou policy, e o índice é só uma trava.
-- ⚠ Depois disto o botão "Nova RM" passa a falhar com 404 do PostgREST — a
--   tela some do caminho, mas nada do que já foi criado no ERP é afetado.
--
--   drop function if exists public.op_rm_marcar_confirmado(uuid, jsonb);
--   drop function if exists public.op_rm_marcar_enviado(uuid, text, jsonb, text);
--   drop function if exists public.op_rm_criar(uuid, jsonb);
--   drop index if exists public.ux_op_requisicoes_reqmat;
--   notify pgrst, 'reload schema';
--
-- Rollback PARCIAL (manter as funções, soltar só a trava de unicidade —
-- se aparecer um caso legítimo de dois registros para o mesmo número):
--
--   drop index if exists public.ux_op_requisicoes_reqmat;
