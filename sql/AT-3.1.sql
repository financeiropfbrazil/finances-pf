-- =============================================================================
-- AT-3.1 · Correção da AT-3 — o livro nunca mente sobre o Alvo
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Fase 4 do módulo OP — `PLANO-RM-ATENDIMENTO.md`.
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação empírica e rollback no fim do arquivo.
--
-- ⚠ Card de CORREÇÃO, no molde da §6.3-N: a AT-3 fica intacta no repo e no
--   histórico. Isto se apende, não substitui.
--
-- 🔴 JANELA DE APLICAÇÃO: a seção 2 faz `create or replace` na
--    `op_reqmat_aplicar_load`, que a Edge `sync-reqmat` chama. O cron roda
--    `25 12,15,18,21 * * 1-5` (UTC). Aplicar em `:05`, `:20`, `:35` ou `:50`,
--    ou fora de dia útil (§2.6 do GUIA-OPERACIONAL-AGENTE.md).
--
-- ESCOPO:
--   · 1 replace na `op_rm_atender_concluir` (dois retornos que passam a carimbar)
--   · 1 replace ADITIVO na `op_reqmat_aplicar_load` (nada muda de comportamento;
--     só o comentário, para o registro ficar correto)
--   · 1 UPDATE de dados: backfill de `codigo_funcionario_conferiu` a partir do `raw`
--   Nenhuma tabela, coluna, policy, cron ou secret é criado ou alterado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFEITO 1 (F1) — existe caminho em que o livro registra como fracasso um
--                  atendimento que BAIXOU ESTOQUE
-- ─────────────────────────────────────────────────────────────────────────────
-- A `op_rm_atender_concluir` da AT-3 tem duas guardas que retornam ANTES de
-- qualquer carimbo:
--
--     · `sem_itens`       — p_itens vazio (Load de confirmação degradado)
--     · `nao_no_espelho`  — a RM não está em `op_reqmat`
--
-- Escrevi as duas pensando "não toque no espelho". Estava certo quanto ao
-- espelho e errado quanto ao LIVRO: elas são alcançadas num estado em que o
-- `FinalizarAtendimento` JÁ RODOU e o material JÁ SAIU. O bloco `exception`
-- cobria "a aplicar_load estourou"; não cobria "não tenho blocos para passar".
--
-- ⇒ O desfecho era um destes dois, ambos errados:
--     (a) o serviço marca `erro` — o livro diz que falhou algo que baixou estoque;
--     (b) o serviço não marca nada — e o expurgo de 15 min da `op_rm_atender_iniciar`
--         carimba `abandonado` um atendimento consumado.
--
-- 🔴 É exatamente o que a `concluir` existe para impedir. E é a família do
--    "caminho feliz que nunca rodou não é caminho validado" (§6.3-N): o defeito
--    só aparece quando o passo 5 falha DEPOIS de o passo 4 ter dado certo.
--
-- ⇒ CORREÇÃO: as duas guardas passam a carimbar `finalizado` com o motivo em
--   `erro_mensagem` e a devolver `success: true, semeado: false` — o MESMO
--   formato do ramo de exceção que já existia. O ERP é a verdade; o espelho
--   ficou para trás; o sync conserta em ≤3 h. O livro passa a dizer sempre o
--   que aconteceu no Alvo.
--
-- ⚠ E deixa de haver caminho em que a `concluir` recusa depois do Finalizar.
--   Os únicos retornos com `success: false` que sobram são os que acontecem
--   ANTES de qualquer escrita no ERP: permissão, sessão, número ausente,
--   tentativa inexistente, status diferente de `validado`, RM divergente.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFEITO 2 (F2) — a coluna `codigo_funcionario_conferiu` nunca seria preenchida
-- ─────────────────────────────────────────────────────────────────────────────
-- A AT-3 criou a coluna e a linha aditiva na `op_reqmat_aplicar_load`. Faltou a
-- outra metade: o `mapearCabecalho` do `supabase/functions/_shared/reqmatMapper.ts`
-- não emite a chave `codigo_funcionario_conferiu`. A RPC sabe gravar e nunca
-- recebe. Medido: 0 preenchidas contra 425 de `codigo_funcionario_retirou`.
--
-- ⇒ A correção do mapper é TypeScript e entra na AT-4 (uma linha aditiva, mais
--   redeploy da Edge `sync-reqmat` pelo Pedro). Este arquivo faz a outra metade:
--   o BACKFILL. O campo `CodigoFuncionarioConferiu` está em 529/529 `raw` do
--   espelho, então o histórico inteiro pode ser preenchido sem tocar no ERP.
--
-- 🔴 E isso retifica o plano. A §2.4 do `PLANO-RM-ATENDIMENTO.md` e a §6.3-N
--    dizem que os campos de Entrega "ficam vazios na operação". Medido no `raw`:
--    `Atendida Total` 315/381 (83%), `Atendida Parcial` 112/122 (92%). O padrão
--    é estável — `Entregou == Conferiu` (o almoxarife) e `Retirou` variando
--    (quem foi buscar).
--    ⇒ A origem do erro é a FAMÍLIA DOS DOIS EIXOS, quarta ocorrência: o Hub
--      não ESPELHAVA `Conferiu`, e quem leu o espelho concluiu que a OPERAÇÃO
--      não preenchia. "O espelho não tem" lido como "a operação não faz".
--    ⇒ Consequência de desenho: a AT-5 deve PRÉ-PREENCHER `Conferiu` com o
--      mesmo valor de `Entregou`, que é o que a operação faz — e o item
--      "preencher os campos de Entrega, que hoje ficam vazios" sai da lista de
--      "onde o Hub pode ser melhor que o Alvo" (§3/AT-5 do plano da fase).
-- =============================================================================


-- =============================================================================
-- 0) PRÉ-VOO (rodar ANTES, colar o resultado)
-- =============================================================================
--   select (select count(*) from public.compras_pedidos) as pedidos,
--          (select count(*) from public.op_reqmat)       as rms,
--          (select count(*) from public.op_reqmat where codigo_funcionario_conferiu is not null) as conferiu_hoje;
--   -- 09/08/2026: pedidos = 1820 · rms = 690 · conferiu_hoje = 0


-- =============================================================================
-- 1) `op_rm_atender_concluir` — as duas guardas passam a carimbar
-- =============================================================================
-- Corpo IDÊNTICO ao da AT-3, com DUAS alterações, ambas no mesmo padrão do ramo
-- de exceção que já existia. Nada mais muda.

create or replace function public.op_rm_atender_concluir(
  p_id        uuid,
  p_numero    text,
  p_cabecalho jsonb,
  p_itens     jsonb,
  p_lotes     jsonb,
  p_raw       jsonb,
  p_resposta  jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_numero   text := nullif(trim(coalesce(p_numero, '')), '');
  v_atual    record;
  v_aplicado jsonb;
begin
  if not public._user_has_perm('producao.rm.atender') then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_permissao',
      'mensagem', 'Sem permissão para concluir o atendimento (producao.rm.atender).');
  end if;
  if v_uid is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_sessao',
      'mensagem', 'Sessão sem auth.uid() — faça login novamente.');
  end if;
  if v_numero is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'sem_numero',
      'mensagem', 'Número da RM não informado.');
  end if;

  select id, status, codigo_empresa_filial, numero_reqmat into v_atual
    from public.op_rm_atendimentos where id = p_id;

  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrado',
      'mensagem', 'Tentativa de atendimento não encontrada no livro do Hub.');
  end if;

  if v_atual.status <> 'validado' then
    return jsonb_build_object('success', false, 'erro_codigo', 'transicao_invalida',
      'mensagem', format('Só se conclui tentativa em "validado" — esta está em "%s".', v_atual.status));
  end if;

  -- Amarra a chamada à MESMA RM da tentativa: impede concluir o id de uma RM
  -- com o corpo de outra (por engano ou pelo console).
  if v_atual.numero_reqmat <> v_numero then
    return jsonb_build_object('success', false, 'erro_codigo', 'rm_divergente',
      'mensagem', format('Esta tentativa é da RM %s; recebido corpo da RM %s — nada gravado.',
                         v_atual.numero_reqmat, v_numero));
  end if;

  -- ── AT-3.1 · ALTERAÇÃO 1 (era `return success:false, sem_itens`) ──
  -- 🔴 Chegar aqui significa que o Finalizar JÁ RODOU. Recusar sem carimbar
  --    deixaria o expurgo de 15 min marcar `abandonado` um atendimento que
  --    baixou estoque. O espelho segue intocado (é o certo — Load degradado
  --    não entra no espelho), mas o LIVRO tem de registrar o que houve.
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    update public.op_rm_atendimentos
       set status        = 'finalizado',
           desfecho_em   = now(),
           resposta_alvo = coalesce(p_resposta, resposta_alvo),
           erro_mensagem = 'Atendimento finalizado no ERP; o corpo de confirmação veio SEM ITENS '
                           || '(Load degradado) e o espelho não foi tocado — o sync corrige em até 3h.'
     where id = p_id;
    return jsonb_build_object('success', true, 'semeado', false, 'numero', v_numero,
      'mensagem', 'Atendimento concluído no ERP. O espelho será atualizado pelo sync.');
  end if;

  -- ── AT-3.1 · ALTERAÇÃO 2 (era `return success:false, nao_no_espelho`) ──
  -- Mesmo raciocínio. Sem a linha do cabeçalho a `aplicar_load` levantaria
  -- `foreign_key_violation`; o sync traz a RM na próxima passada.
  if not exists (
    select 1 from public.op_reqmat
     where codigo_empresa_filial = v_atual.codigo_empresa_filial
       and numero = v_numero
  ) then
    update public.op_rm_atendimentos
       set status        = 'finalizado',
           desfecho_em   = now(),
           resposta_alvo = coalesce(p_resposta, resposta_alvo),
           erro_mensagem = format('Atendimento finalizado no ERP; a RM %s não estava no espelho '
                                  || 'e não pôde ser atualizada — o sync a traz em até 3h.', v_numero)
     where id = p_id;
    return jsonb_build_object('success', true, 'semeado', false, 'numero', v_numero,
      'mensagem', 'Atendimento concluído no ERP. A requisição aparece atualizada após a sincronização.');
  end if;

  -- ── Filhos + cabeçalho + carimbos, NUM ÚNICO COMMIT ──
  -- A chamada passa porque somos DEFINER com owner `postgres`, dono da função
  -- de destino (mecanismo do §10.28 / OP-2.9). O revoke dela continua de pé
  -- para anon e authenticated.
  begin
    v_aplicado := public.op_reqmat_aplicar_load(
      v_atual.codigo_empresa_filial, v_numero,
      coalesce(p_cabecalho, '{}'::jsonb), p_itens, p_lotes, p_raw
    );
  exception when others then
    update public.op_rm_atendimentos
       set status        = 'finalizado',
           desfecho_em   = now(),
           resposta_alvo = coalesce(p_resposta, resposta_alvo),
           erro_mensagem = 'Atendimento finalizado no ERP; a semeadura do espelho falhou: '
                           || sqlerrm || ' — o sync corrige em até 3h.'
     where id = p_id;
    return jsonb_build_object('success', true, 'semeado', false, 'numero', v_numero,
      'mensagem', 'Atendimento concluído no ERP. O espelho não pôde ser atualizado agora e será corrigido pelo sync.');
  end;

  update public.op_rm_atendimentos
     set status        = 'finalizado',
         desfecho_em   = now(),
         resposta_alvo = coalesce(p_resposta, resposta_alvo),
         erro_mensagem = null
   where id = p_id;

  return jsonb_build_object(
    'success',          true,
    'semeado',          true,
    'numero',           v_numero,
    'itens_inseridos',  coalesce((v_aplicado->>'itens_inseridos')::int, 0),
    'lotes_inseridos',  coalesce((v_aplicado->>'lotes_inseridos')::int, 0),
    'load_status_lido', v_aplicado->>'load_status_lido'
  );
end $function$;

comment on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) is
  'AT-3 (+AT-3.1) · Fecha o ciclo de atendimento: exige tentativa ''validado'' DA MESMA RM, delega itens/lotes/carimbos à op_reqmat_aplicar_load (DEFINER→owner, §10.28) para a RM atendida aparecer NA HORA, e carimba ''finalizado''. Blocos vêm de um ReqMat/Load de confirmação via montarBlocosDoLoad — nunca do payload do Hub. 🔴 AT-3.1: TODO caminho posterior ao Finalizar carimba ''finalizado'', inclusive corpo sem itens, RM ausente do espelho e falha da semeadura — devolvendo semeado:false com o motivo. Depois do Finalizar o livro NUNCA registra fracasso: o ERP é a verdade e o sync conserta o espelho. Os únicos success:false que restam ocorrem ANTES de qualquer escrita no ERP.';

-- Higiene: replace preserva ACL, mas o revoke de `anon` é barato e a regra do
-- projeto manda sempre conferir (pg_default_acl — §6.3-N).
revoke execute on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
revoke execute on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) from anon;
grant  execute on function public.op_rm_atender_concluir(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;


-- =============================================================================
-- 2) BACKFILL de `codigo_funcionario_conferiu` a partir do `raw`
-- =============================================================================
-- O campo `CodigoFuncionarioConferiu` está presente em 529/529 raws do espelho.
-- Enquanto o `reqmatMapper.ts` não ganhar a chave (AT-4) e a Edge não for
-- redeployada, o sync não preenche a coluna — mas o dado já está no `raw`, e o
-- histórico pode ser recuperado sem tocar no ERP.
--
-- ⚠ Idempotente: só toca linha com a coluna nula e valor não-vazio no raw.
--   Reexecutar não faz nada. E NÃO sobrescreve valor já gravado — quando o
--   mapper entrar, ele é a fonte, não isto.
--
-- ⚠ `nullif(trim(...), '')` porque o Alvo devolve string vazia em RM `Aberta`
--   (26 casos), e vazio não é "conferido por ninguém": é "ainda não atendida".

update public.op_reqmat
   set codigo_funcionario_conferiu = nullif(trim(raw->>'CodigoFuncionarioConferiu'), '')
 where codigo_funcionario_conferiu is null
   and raw is not null
   and nullif(trim(raw->>'CodigoFuncionarioConferiu'), '') is not null;


-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =============================================================================
-- Bloco único — o SQL Editor mostra só o resultado da última consulta.
--
--   select 'a · concluir: nenhum success:false depois do Finalizar' as verificacao,
--          case when prosrc like '%erro_codigo%sem_itens%' or prosrc like '%erro_codigo%nao_no_espelho%'
--               then '🔴 AINDA HÁ RECUSA — a seção 1 não aplicou'
--               else 'ok — as duas guardas carimbam finalizado' end as resultado
--     from pg_proc where proname = 'op_rm_atender_concluir'
--       and pronamespace = 'public'::regnamespace
--   union all
--   select 'b · concluir: anon fora, auth dentro',
--          'anon=' || has_function_privilege('anon', oid, 'EXECUTE') ||
--          ' · auth=' || has_function_privilege('authenticated', oid, 'EXECUTE')
--     from pg_proc where proname = 'op_rm_atender_concluir'
--       and pronamespace = 'public'::regnamespace
--   union all
--   select 'c · backfill do conferiu',
--          count(*) filter (where codigo_funcionario_conferiu is not null) || ' de ' || count(*) ||
--          ' RMs · atendidas: ' ||
--          count(*) filter (where codigo_funcionario_conferiu is not null
--                             and status like 'Atendida%') || ' de ' ||
--          count(*) filter (where status like 'Atendida%')
--     from public.op_reqmat
--   union all
--   select 'd · fingerprint', (select count(*)::text from public.compras_pedidos)
--   order by 1;
--
--   Esperado: (a) ok · (b) anon=false, auth=true · (c) ~427 de 690, e nas
--   atendidas algo perto de 427 de 503 · (d) ≥ 1820.
--   🔴 Se (c) vier 0 de 690, o UPDATE da seção 2 não rodou.


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- ⚠ O backfill NÃO se desfaz — e não deveria: o dado veio do `raw`, que é a
--   resposta crua do próprio ERP. Desfazê-lo apagaria informação verdadeira.
--   Se por algum motivo for necessário:
--     update public.op_reqmat set codigo_funcionario_conferiu = null;
--
-- A seção 1 se reverte reaplicando o `create or replace function
-- public.op_rm_atender_concluir(...)` EXATAMENTE como está em `sql/AT-3.sql`.
-- ⚠ Reverter reabre o DEFEITO 1: volta a existir caminho em que o livro
--   registra como fracasso um atendimento que baixou estoque. Não reverter sem
--   motivo forte.
--
--   notify pgrst, 'reload schema';   -- (não é necessário: nenhuma assinatura mudou)
