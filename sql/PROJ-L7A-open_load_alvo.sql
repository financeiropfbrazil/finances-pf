-- =====================================================================
-- PROJ-L7A — Open-load do Alvo: campos de leitura + RPC de sincronizacao
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 12 (L7-A)
--
-- ESTADO: PENDENTE de aplicacao.
-- PRE-REQUISITOS: L1..L4 aplicados.
-- Idempotente: add column if not exists + drop/create function.
--
-- O QUE E:
--   O front passa a consultar GET /ped-comp/:filial/:numero no erp-proxy a cada
--   abertura do detalhe do projeto (so para linhas com numero_pedido_alvo) e
--   grava aqui o retorno do Alvo. Assim o Hub para de mentir sobre pedido que
--   mudou (ou sumiu) no ERP.
--
-- ###################################################################
-- REGRA DURA — 404 NAO MARCA EXCLUSAO
--   Em Suprimentos, marcar excluido_alvo por 404 isolado marcou 7 pedidos VIVOS.
--   Aqui o 404 apenas carimba alvo_nao_encontrado_em + alvo_sync_erro e a tela
--   avisa. Quem pode marcar exclusao e o cross-check (404 no Load E ausencia no
--   /ped-comp/list da janela) — que NAO esta implementado neste lote.
--   Por isso esta RPC nao tem nenhum caminho que escreva 'excluido_alvo'.
-- ###################################################################
--
-- SEPARACAO DE STATUS (nao misturar, nunca sobrescrever):
--   projeto_requisicoes.status  = status LOCAL do Hub ('rascunho','erro','enviado')
--   projeto_requisicoes.status_alvo = Status cru do ERP ('Aberto','Encerrado',...)
--   Quem unifica os dois para a UI e src/lib/statusPedido.ts — arquivo unico,
--   compartilhado com Suprimentos. Nao existe mapa de status proprio de Projetos.
-- =====================================================================


-- =====================================================================
-- 1) Campos do Alvo em projeto_requisicoes
--    Nomes iguais aos de compras_pedidos, de proposito: e o que permite
--    alimentar getStatusPedido() sem traduzir nada.
-- =====================================================================
alter table public.projeto_requisicoes
  add column if not exists status_alvo             text,        -- Status: Aberto/Pendente/Encerrado/Cancelado/Cancelado Parcial/Reavaliar
  add column if not exists aprovado                text,        -- Aprovado: Total / Não
  add column if not exists status_aprovacao        text,        -- StatusAprovacao: Nenhum / Em Andamento / Reavaliar / Finalizada
  add column if not exists comprado                text,        -- Comprado: Sim / Não
  add column if not exists enviou_aprovacao        text,        -- UserEnviouAprovacao
  add column if not exists proximo_aprovador       text,        -- UserProximoAprovador
  add column if not exists alvo_synced_at          timestamptz, -- ultima tentativa de leitura bem-sucedida OU 404 tratado
  add column if not exists alvo_sync_erro          text,        -- mensagem do ultimo erro de leitura
  add column if not exists alvo_nao_encontrado_em  timestamptz; -- 404 no Load. NAO significa exclusao (ver REGRA DURA)

comment on column public.projeto_requisicoes.status_alvo is
  'Status cru do ERP Alvo. NAO confundir com projeto_requisicoes.status, que e o status local do Hub.';
comment on column public.projeto_requisicoes.alvo_nao_encontrado_em is
  'Timestamp do ultimo 404 no Load do Alvo. Sinal de investigacao, NAO de exclusao: so o cross-check (404 + ausencia na lista) pode concluir exclusao.';


-- =====================================================================
-- 2) RPC de sincronizacao (D-4: escrita so por RPC)
-- =====================================================================
drop function if exists public.projeto_pedido_sync_alvo(uuid, boolean, jsonb, text);

create or replace function public.projeto_pedido_sync_alvo(
  p_id         uuid,
  p_encontrado boolean,
  p_dados      jsonb default '{}'::jsonb,
  p_erro       text  default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_perm constant text := 'projetos.pedidos.create';
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_row      public.projeto_requisicoes%rowtype;
  v_new      public.projeto_requisicoes%rowtype;
  v_proj     public.projetos%rowtype;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  v_is_admin := public._is_admin();

  select * into v_row from public.projeto_requisicoes where id = p_id for update;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;

  select * into v_proj from public.projetos where id = v_row.projeto_id;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  -- Gate: quem enxerga o projeto pode sincronizar a leitura dele.
  -- Mais permissivo que salvar/excluir de proposito — isto NAO altera dado de
  -- negocio, so espelha o que o ERP respondeu. Inclui o aprovador, que precisa
  -- ver o andamento sem poder operar.
  if not v_is_admin
     and v_proj.responsavel_id is distinct from v_uid
     and v_proj.aprovador_id   is distinct from v_uid
     and not public._user_has_perm('projetos.view_all')
     and not public._user_has_perm(c_perm) then
    raise exception 'Sem permissão para sincronizar pedidos deste projeto'
      using errcode = '42501';
  end if;

  -- So faz sentido para pedido que existe no ERP.
  if v_row.numero_pedido_alvo is null then
    raise exception 'Pedido ainda não foi enviado ao Alvo — nada a sincronizar'
      using errcode = '22023';
  end if;

  if p_encontrado then
    update public.projeto_requisicoes set
      status_alvo            = nullif(btrim(coalesce(p_dados->>'status_alvo','')), ''),
      aprovado               = nullif(btrim(coalesce(p_dados->>'aprovado','')), ''),
      status_aprovacao       = nullif(btrim(coalesce(p_dados->>'status_aprovacao','')), ''),
      comprado               = nullif(btrim(coalesce(p_dados->>'comprado','')), ''),
      enviou_aprovacao       = nullif(btrim(coalesce(p_dados->>'enviou_aprovacao','')), ''),
      proximo_aprovador      = nullif(btrim(coalesce(p_dados->>'proximo_aprovador','')), ''),
      alvo_synced_at         = now(),
      alvo_sync_erro         = null,
      alvo_nao_encontrado_em = null   -- reapareceu: limpa o alerta anterior
      -- status (local), bloqueado, valor_total e numero_pedido_alvo: intocados
     where id = p_id
    returning * into v_new;
  else
    -- 404 / erro de leitura. NAO mexe em status nem marca exclusao (REGRA DURA).
    update public.projeto_requisicoes set
      alvo_synced_at         = now(),
      alvo_sync_erro         = p_erro,
      alvo_nao_encontrado_em = coalesce(v_row.alvo_nao_encontrado_em, now())  -- preserva o 1o avistamento
     where id = p_id
    returning * into v_new;
  end if;

  return jsonb_build_object(
    'success',    true,
    'encontrado', p_encontrado,
    'pedido',     to_jsonb(v_new)
  );
end;
$function$;

revoke all     on function public.projeto_pedido_sync_alvo(uuid,boolean,jsonb,text) from public, anon;
grant  execute on function public.projeto_pedido_sync_alvo(uuid,boolean,jsonb,text) to authenticated, service_role;

notify pgrst, 'reload schema';


-- =====================================================================
-- 3) VERIFICACAO POR LEITURA
-- =====================================================================

-- 3.1 Colunas novas
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='projeto_requisicoes'
   and column_name in ('status_alvo','aprovado','status_aprovacao','comprado',
                       'enviou_aprovacao','proximo_aprovador','alvo_synced_at',
                       'alvo_sync_erro','alvo_nao_encontrado_em')
 order by column_name;
-- Esperado: 9 linhas, todas nullable

-- 3.2 RPC
select p.proname,
       pg_get_function_identity_arguments(p.oid)                as assinatura,
       p.prosecdef                                              as security_definer,
       p.proconfig::text                                        as search_path,
       has_function_privilege('authenticated', p.oid,'EXECUTE') as auth_executa,
       has_function_privilege('anon',          p.oid,'EXECUTE') as anon_executa,
       -- REGRA DURA: a RPC nao pode ter nenhum caminho que escreva 'excluido_alvo'
       (pg_get_functiondef(p.oid) ilike '%excluido_alvo%')       as menciona_excluido_alvo
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='projeto_pedido_sync_alvo';
-- Esperado: true | {"search_path=public, auth"} | true | false | FALSE

-- 3.3 Estado atual dos pedidos que existem no Alvo
select p.nome as projeto, r.sequencia, r.numero_pedido_alvo,
       r.status as status_local, r.status_alvo, r.aprovado, r.status_aprovacao,
       r.comprado, r.alvo_synced_at, r.alvo_nao_encontrado_em
  from public.projeto_requisicoes r
  join public.projetos p on p.id = r.projeto_id
 where r.numero_pedido_alvo is not null
 order by r.enviado_em;
-- Hoje: 2 pedidos (0004238 e 0004626), com as colunas do Alvo ainda nulas.


-- =====================================================================
-- 4) SMOKE TEST (opcional; Regra 10: sem temp table, rollback no fim)
--    Simula o open-load gravando um retorno do Alvo e, depois, um 404.
-- =====================================================================
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','<uid-do-responsavel>','role','authenticated')::text, true);
set local role authenticated;

-- caso encontrado
select public.projeto_pedido_sync_alvo(
         (select id from public.projeto_requisicoes where numero_pedido_alvo='0004626'),
         true,
         jsonb_build_object('status_alvo','Aberto','aprovado','Não',
                            'status_aprovacao','Em Andamento','comprado','Não',
                            'enviou_aprovacao','Sim','proximo_aprovador','FULANO')
       ) as caso_encontrado;

-- caso 404: NAO pode mexer em status nem marcar exclusao
select public.projeto_pedido_sync_alvo(
         (select id from public.projeto_requisicoes where numero_pedido_alvo='0004238'),
         false, '{}'::jsonb, 'HTTP 404 no Load'
       ) as caso_404;

reset role;
select numero_pedido_alvo, status as status_local, status_alvo,
       alvo_sync_erro, alvo_nao_encontrado_em
  from public.projeto_requisicoes where numero_pedido_alvo is not null;
rollback;
*/
-- Esperado: no caso_404, status_local segue 'enviado' e alvo_nao_encontrado_em
-- preenchido — nunca 'excluido_alvo'.


-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.projeto_pedido_sync_alvo(uuid,boolean,jsonb,text);
--   alter table public.projeto_requisicoes
--     drop column if exists status_alvo,
--     drop column if exists aprovado,
--     drop column if exists status_aprovacao,
--     drop column if exists comprado,
--     drop column if exists enviou_aprovacao,
--     drop column if exists proximo_aprovador,
--     drop column if exists alvo_synced_at,
--     drop column if exists alvo_sync_erro,
--     drop column if exists alvo_nao_encontrado_em;
--   notify pgrst, 'reload schema';
-- =====================================================================
