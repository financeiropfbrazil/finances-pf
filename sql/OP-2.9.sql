-- =============================================================================
-- OP-2.9 · `op_reqmat_semear_criacao` — a RM criada no Hub aparece na hora
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- ESCOPO: 1 função nova. Nenhuma tabela, coluna, policy, cron, índice ou secret
-- é criado ou alterado. Não há DML.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O PROBLEMA, MEDIDO EM 08/08/2026
-- ─────────────────────────────────────────────────────────────────────────────
-- O primeiro teste real da OP-2.7 funcionou: RM `0000002286`, ciclo de três
-- passos em 10 s, `status_envio = 'confirmado'`, e no Alvo `Origem =
-- "Importação"`, `TipoAtendimento = "Manual"`.
--
-- 🔴 E ela não apareceu em lugar nenhum da fila. A fila lê `op_reqmat` — o
--    espelho —, e o espelho só anda 4×/dia. Como era sábado e o cron roda
--    `* * 1-5`, ela ficaria invisível até segunda-feira.
--
-- ⇒ DECISÃO: a RM criada pelo Hub é gravada no espelho NA HORA DA CRIAÇÃO. Uma
--   tabela só — sem merge em memória, sem view, sem bloco separado na tela. O
--   sync assume na próxima passada e atualiza o que só ele sabe: atendimento,
--   lote, saldo, status.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUE UMA FUNÇÃO NOVA, E NÃO UMA POLICY DE INSERT
-- ─────────────────────────────────────────────────────────────────────────────
-- `op_reqmat` tem RLS ligada e EXATAMENTE UMA policy, de SELECT. Medido em
-- 08/08/2026: os GRANTs de tabela são os amplos do Supabase (`authenticated` tem
-- INSERT/UPDATE/DELETE em `op_reqmat`, `op_reqmat_itens` e `op_reqmat_lotes`)
-- ⇒ **quem barra a escrita é a AUSÊNCIA de policy, não o grant.** Criar uma
-- policy de INSERT ali abriria o espelho inteiro a qualquer um dos 100+ usuários
-- pelo console do navegador: é o BL-5 na forma literal.
--
-- ⇒ A escrita passa por esta função, que é `SECURITY DEFINER`, gateada por
--   `producao.rm.create` E estreitada por uma segunda condição: só semeia número
--   que exista em `op_requisicoes` com `status_envio = 'enviado'`. Não é RPC
--   genérica de escrita no espelho — é o passo 4 de UM ciclo de criação.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 POR QUE ELA DELEGA OS FILHOS À `op_reqmat_aplicar_load`
-- ─────────────────────────────────────────────────────────────────────────────
-- Aquela função já faz delete + insert de itens e lotes + carimbo NUM ÚNICO
-- COMMIT, e a transação existe por um motivo medido: entre o DELETE e o INSERT
-- haveria uma janela em que a RM fica SEM FILHOS, e o consolidado da OP leria
-- "atendido 0 / tudo em aberto" numa tela que decide requisição de material.
-- Reimplementar aquilo aqui seria abrir a janela de novo, com outro nome.
--
-- ⚠ Ela é `revoke`ada de `anon` e `authenticated` e concedida só a
--   `service_role` — e MESMO ASSIM esta chamada passa. Não é brecha: é o
--   mecanismo do §10.28. `op_reqmat_semear_criacao` é `SECURITY DEFINER` com
--   owner `postgres`, então dentro dela `current_user = postgres`, que é o DONO
--   da `op_reqmat_aplicar_load` e portanto tem EXECUTE sobre ela. O usuário
--   continua sem alcançá-la diretamente — que é exatamente o desejado.
--   Conferido no banco em 08/08/2026:
--     has_function_privilege('postgres',      …aplicar_load…, 'execute') = true
--     has_function_privilege('authenticated', …aplicar_load…, 'execute') = false
--     owner de ambas = postgres
--
-- ⚠ A `aplicar_load` EXIGE que a linha já exista em `op_reqmat` (ela levanta
--   `foreign_key_violation` com "o passo A precisa rodar antes"). É por isso que
--   esta função insere o cabeçalho ANTES de delegar — e é a única razão de ela
--   existir.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 O `revoke ... from public` NÃO BASTA NESTE PROJETO — a causa, medida
-- ─────────────────────────────────────────────────────────────────────────────
-- Na OP-2.7 o arquivo trazia `revoke execute … from public` e as três `op_rm_*`
-- nasceram MESMO ASSIM com EXECUTE para `anon`; foi preciso um
-- `revoke execute … from anon` por função, com a assinatura completa.
--
-- A causa está em `pg_default_acl`, e foi lida no banco em 08/08/2026:
--
--   defaclrole | defaclnamespace | defaclobjtype | defaclacl
--   postgres   | public          | f (function)  | {postgres=X/postgres,
--                                                   anon=X/postgres,
--                                                   authenticated=X/postgres,
--                                                   service_role=X/postgres}
--
-- ⇒ Existe um `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
--   FUNCTIONS TO anon, authenticated, service_role` (padrão do Supabase). Toda
--   função nova criada por `postgres` em `public` nasce com EXECUTE concedido
--   **NOMINALMENTE a `anon`** — não herdado de PUBLIC.
--
-- ⇒ `revoke … from public` remove o grant de PUBLIC, que aqui nem existe, e
--   deixa o de `anon` intacto. **A única forma de tirar é revogar de `anon` por
--   nome, com a assinatura completa.** Vale para TODA RPC nova deste projeto,
--   não só para esta — é a regra, não a exceção.
--
-- ⚠ E o `revoke` tem de vir DEPOIS do `create or replace`: replace numa função
--   existente PRESERVA o ACL, mas na criação o default entra primeiro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRATO DE RETORNO — o mesmo envelope das três RPCs da OP-2.7
-- ─────────────────────────────────────────────────────────────────────────────
--     sucesso → { "success": true,  "itens_inseridos": n, "lotes_inseridos": n }
--     falha   → { "success": false, "mensagem": "...", "erro_codigo": "..." }
--
-- Códigos: sem_permissao · sem_sessao · sem_numero · nao_no_livro · sem_itens
--
-- ⚠ Falha aqui NÃO derruba a criação. Quem chama (`reqMatEspelhoService.ts`)
--   apenas anota o aviso: a RM está correta no ERP e o sync a traz em ≤3h. O
--   único prejuízo é a linha demorar a aparecer — que é o estado de antes desta
--   entrega, não uma regressão.
-- =============================================================================


-- =============================================================================
-- 1) `op_reqmat_semear_criacao`
-- =============================================================================
create or replace function public.op_reqmat_semear_criacao(
  p_numero    text,
  p_cabecalho jsonb,
  p_itens     jsonb,
  p_lotes     jsonb,
  p_raw       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid := auth.uid();
  v_numero    text := nullif(trim(coalesce(p_numero, '')), '');
  v_filial    text;
  v_aplicado  jsonb;
begin
  if not public._user_has_perm('producao.rm.create') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para gravar a requisição no espelho (producao.rm.create).');
  end if;
  if v_uid is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_sessao',
      'mensagem', 'Sessão sem auth.uid() — faça login novamente.');
  end if;
  if v_numero is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_numero',
      'mensagem', 'Número da RM não informado.');
  end if;

  -- 🔴 A SEGUNDA TRANCA, e é ela que impede esta função de virar "INSERT livre
  --    no espelho": o número tem de existir no LIVRO, em `enviado`.
  --
  --    `enviado` é o estado exato entre o passo 1 (Insert aceito, número
  --    gravado) e o passo 4 (`op_rm_marcar_confirmado`). Fora dessa janela não
  --    há o que semear:
  --      · `pendente`   — o Alvo ainda não devolveu número;
  --      · `erro`       — nada foi criado lá;
  --      · `confirmado` — o ciclo já fechou; uma segunda semeadura seria
  --                       reescrita não solicitada do espelho.
  --
  --    ⇒ Isto é o que amarra a escrita a UMA criação em curso, feita por quem
  --      tem a permissão, e não a uma chamada solta pelo console do navegador.
  select codigo_empresa_filial into v_filial
    from public.op_requisicoes
   where numero_reqmat = v_numero
     and status_envio = 'enviado'
   limit 1;

  if v_filial is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_no_livro',
      'mensagem', format('A RM %s não está em envio no livro do Hub — nada a gravar no espelho.', v_numero));
  end if;

  -- Guarda espelhada da `op_reqmat_aplicar_load` (cinto e suspensório): NÃO
  -- EXISTE RM SEM ITEM. Chegar aqui com lista vazia é sintoma de Load
  -- degradado, e o insert do cabeçalho criaria uma linha órfã de filhos que a
  -- fila mostraria como "0 itens".
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_itens',
      'mensagem', format('A RM %s veio sem itens do ERP — não gravada no espelho.', v_numero));
  end if;

  -- ── Cabeçalho: o MÍNIMO, e de propósito ──
  -- Só a chave e o carimbo. As ~20 colunas de conteúdo são preenchidas logo
  -- abaixo pela `op_reqmat_aplicar_load`, com a mesma omissão fina que o sync
  -- usa (`jsonb_exists` coluna a coluna). Repetir a lista aqui criaria uma
  -- segunda definição de "o que é o cabeçalho" — e as duas divergiriam no
  -- primeiro campo novo.
  --
  -- ⚠ `sincronizado_em = now()` é EXPLÍCITO porque é ele que o indicador da
  --   tela compara: enquanto `op_reqmat.sincronizado_em` for anterior ao
  --   `op_requisicoes.confirmado_em`, a linha mostra "criada agora, atendimento
  --   atualiza na próxima sincronização". O primeiro passo A do sync reescreve
  --   `sincronizado_em` e o aviso se apaga sozinho — sem ninguém limpar nada.
  --
  -- ⚠ `on conflict do nothing`: se o sync chegou primeiro (corrida improvável,
  --   mas possível), a linha dele fica e nós seguimos para o update — o Load é
  --   o mesmo, então o resultado é idêntico. NUNCA sobrescrever o cabeçalho
  --   aqui: `ausente_desde`, `raw` e os carimbos do sync são dele.
  insert into public.op_reqmat (codigo_empresa_filial, numero, sincronizado_em)
  values (v_filial, v_numero, now())
  on conflict (codigo_empresa_filial, numero) do nothing;

  -- ── Filhos + cabeçalho + carimbos, NUM ÚNICO COMMIT ──
  -- Ver o cabeçalho deste arquivo: a chamada passa porque somos DEFINER com
  -- owner `postgres`, dono da função de destino. O REVOKE dela continua de pé
  -- para `anon` e `authenticated`.
  v_aplicado := public.op_reqmat_aplicar_load(
    v_filial, v_numero, coalesce(p_cabecalho, '{}'::jsonb), p_itens, p_lotes, p_raw
  );

  return jsonb_build_object(
    'success',          true,
    'numero',           v_numero,
    'itens_inseridos',  coalesce((v_aplicado->>'itens_inseridos')::int, 0),
    'lotes_inseridos',  coalesce((v_aplicado->>'lotes_inseridos')::int, 0),
    'load_status_lido', v_aplicado->>'load_status_lido'
  );
end $function$;

comment on function public.op_reqmat_semear_criacao(text, jsonb, jsonb, jsonb, jsonb) is
  'OP-2.9 · Grava no espelho (op_reqmat + itens + lotes) a RM que o Hub acabou de criar no Alvo, a partir do corpo do ReqMat/Load do passo 3 — para que ela apareça na fila NA HORA, sem esperar o sync (4x/dia). Gateada por producao.rm.create E restrita a número que exista em op_requisicoes com status_envio=''enviado'': não é escrita genérica no espelho. Insere só a chave do cabeçalho e delega itens, lotes e carimbos à op_reqmat_aplicar_load, preservando a transação única daquela função. Falhar aqui NÃO derruba a criação: a RM está correta no ERP e o sync a traz em <=3h.';


-- =============================================================================
-- 2) GRANTS — `authenticated` sim, `anon` NÃO
-- =============================================================================
-- ⚠ O `revoke from anon` é OBRIGATÓRIO e não é redundante: ver a seção sobre
--   `pg_default_acl` no cabeçalho. Sem ele a função nasce chamável por `anon`.
--   `from public` fica junto por higiene — não custa nada e cobre o dia em que
--   o default privilege for removido.
revoke execute on function public.op_reqmat_semear_criacao(text, jsonb, jsonb, jsonb, jsonb) from public;
revoke execute on function public.op_reqmat_semear_criacao(text, jsonb, jsonb, jsonb, jsonb) from anon;

grant execute on function public.op_reqmat_semear_criacao(text, jsonb, jsonb, jsonb, jsonb) to authenticated;


-- =============================================================================
-- 3) PostgREST — recarregar o cache de schema
-- =============================================================================
-- Sem isto, `supabase.rpc('op_reqmat_semear_criacao', …)` responde 404 até o
-- próximo reload — e o sintoma no app seria o aviso "criada no ERP, mas ainda
-- não pôde ser gravada na lista do Hub" em TODA criação.
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =============================================================================
-- a) a função existe com os atributos certos e NÃO é chamável por anon:
--
--   select proname, prosecdef as security_definer, proconfig as search_path,
--          pg_get_userbyid(proowner) as owner,
--          has_function_privilege('anon',          oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth,
--          proacl::text
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname = 'op_reqmat_semear_criacao';
--
--   Esperado: security_definer = t, search_path = {search_path=public},
--   owner = postgres, anon = FALSE, auth = TRUE.
--   🔴 Se `anon` vier TRUE, o revoke da seção 2 não rodou — é o defeito da
--      OP-2.7 se repetindo. Rode a seção 2 sozinha e confira de novo.
--
-- b) a delegação alcança a função revogada (o mecanismo do §10.28):
--
--   select has_function_privilege('postgres',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)','execute') as owner_pode,
--          has_function_privilege('authenticated',
--            'public.op_reqmat_aplicar_load(text,text,jsonb,jsonb,jsonb,jsonb)','execute') as usuario_pode;
--
--   Esperado: true, false. Se `usuario_pode` virar true, alguém afrouxou a
--   OP-2.3 — o espelho ficou gravável direto pelo app.
--
-- c) o espelho continua SEM escrita direta — é o ponto do arquivo:
--
--   select polname, polcmd from pg_policy
--    where polrelid in ('public.op_reqmat'::regclass,
--                       'public.op_reqmat_itens'::regclass,
--                       'public.op_reqmat_lotes'::regclass);
--
--   Esperado: 3 linhas, todas polcmd = 'r' (SELECT). Qualquer 'a'/'w'/'d' aqui
--   significa que algo além deste arquivo foi aplicado.
--
-- d) o gate responde (no SQL Editor, sem autenticação, o esperado é recusar —
--    é a armadilha registrada no CLAUDE.md, não um defeito):
--
--   select public.op_reqmat_semear_criacao('0000000000','{}'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb);
--
--   Esperado: {"success": false, "erro_codigo": "sem_permissao", …}
--
-- e) 🔴 FIM A FIM, NA TELA — é a validação que vale. Criar uma RM na OP
--    2026-0503 e conferir que ela aparece na fila IMEDIATAMENTE, sem esperar o
--    cron. Depois, a prova nas duas tabelas:
--
--   select r.numero_reqmat, r.status_envio, r.confirmado_em,
--          e.numero, e.status, e.origem, e.tipo_atendimento,
--          e.sincronizado_em, e.detalhes_carregados_em, e.precisa_releitura,
--          (select count(*) from public.op_reqmat_itens i
--            where i.numero_reqmat = e.numero) as itens
--     from public.op_requisicoes r
--     left join public.op_reqmat e on e.numero = r.numero_reqmat
--    order by r.criado_em desc limit 5;
--
--   Esperado na linha nova: status_envio = 'confirmado', a RM PRESENTE em
--   op_reqmat, status = 'Aberta', origem = 'Importação', tipo_atendimento =
--   'Manual', precisa_releitura = TRUE (ela entra na fila do sync
--   naturalmente), itens > 0, e `sincronizado_em` ANTERIOR a `confirmado_em`
--   — é essa desigualdade que acende o aviso "criada agora" na tela, e é ela
--   que o primeiro sync desfaz.
--
-- f) e DEPOIS do primeiro sync (09h25/12h25/15h25/18h25 BRT, dias úteis), a
--    prova de que a linha não "piscou": os mesmos campos, com
--    `sincronizado_em` agora POSTERIOR a `confirmado_em` e o resto IGUAL.
--    Divergência de formato aqui significaria que os dois caminhos mapearam
--    diferente — e é exatamente o que o mapper compartilhado existe para
--    impedir.
--
-- g) a guarda de recência do sync (exige o redeploy da Edge Function):
--
--   select started_at, detalhes from public.sync_runs
--    where job_type = 'reqmat' order by started_at desc limit 1;
--
--   Se uma RM foi criada entre o retrato da listagem e a checagem de ausência,
--   `detalhes` traz uma etapa 'ausencia' com "criadas no espelho DEPOIS do
--   retrato da listagem". É info, não erro. ⚠ O que NÃO pode aparecer é o
--   número dela em `ausentes_numeros`.


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- Reverte 100% do arquivo. Seguro a qualquer momento: a função não é
-- referenciada por trigger, view, policy ou cron, e nada do que ela gravou é
-- desfeito (o espelho fica como está, e o sync continua mantendo-o).
--
-- ⚠ Depois disto, a criação de RM volta ao comportamento da OP-2.7: a RM é
--   criada corretamente no ERP e a tela mostra o aviso "criada no ERP, mas
--   ainda não pôde ser gravada na lista do Hub" — porque o `rpc` responde 404.
--   Nada quebra; a RM aparece no próximo sync. É degradação, não falha.
--
--   drop function if exists public.op_reqmat_semear_criacao(text, jsonb, jsonb, jsonb, jsonb);
--   notify pgrst, 'reload schema';
