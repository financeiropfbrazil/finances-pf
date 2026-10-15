-- =====================================================================
-- PROJ-L10 — "Enviar para aprovação" no pedido do Projetos
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md seção 3 (L10) — decisões do Pedro em 15/10/2026:
--   aprovação sempre junto com o envio, com aviso explícito na confirmação;
--   botão avulso para pedido já criado; 1º teste no pedido 0004799 (R$ 100,
--   projeto "teste").
--
-- ESTADO: PENDENTE de aplicação (aguarda OK do Pedro).
-- Sem DELETE/DROP — pode ir pelo MCP. Rollback em PROJ-L10-rollback.sql.
--
-- DESENHO (o mesmo caminho manual do Suprimentos, já usado em 111+ pedidos):
--   1. o pedido é criado no Alvo como hoje (SEM comando de aprovação no insert —
--      incidente §13: o 0004664, R$ 110 mil, nasceu enviado e foi aprovado sem
--      ninguém no Hub ter dado o comando);
--   2. o Hub lê o pedido do Alvo, confere que ainda não foi para aprovação e
--      liga SÓ o comando UserEnviarAprovacao = "Sim" (POST /ped-comp/update).
--      UserEnviouAprovacao é o FATO, derivado pelo ERP — o Hub nunca escreve;
--   3. o comando fica registrado no Hub (este SQL): quem deu, quando, o estado
--      do Alvo antes e a resposta. O FATO (enviou_aprovacao, status_aprovacao)
--      continua vindo só da leitura do Alvo (projeto_pedido_sync_alvo) —
--      LIVRO (o Hub mandou) × ESPELHO (o Alvo diz que foi) não se misturam.
--
-- O QUE CRIA:
--   1. projeto_evento_log: catálogo ganha 'pedido_enviado_aprovacao' e
--      'pedido_aprovacao_falhou' (resto da função idêntico; md5 do corpo
--      anterior: b0def584c2e3079e4d6e704a03a8f3ce).
--   2. RPC projeto_pedido_registrar_aprovacao(p_id, p_sucesso, p_detalhes):
--      p_sucesso null = pré-voo (só confere permissão/estado, não grava);
--      true/false = grava o evento do comando (dado ou falho).
-- =====================================================================


-- =====================================================================
-- 0) PRÉ-VOO (rodar antes; parar se divergir)
-- =====================================================================
-- select (select count(*) from public.compras_pedidos) as compras_pedidos,    -- ~2.295
--        md5(replace((select prosrc from pg_proc where oid = 'public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb)'::regprocedure), E'\r\n', E'\n')) as md5_log,
--        -- esperado: b0def584c2e3079e4d6e704a03a8f3ce
--        to_regprocedure('public.projeto_pedido_registrar_aprovacao(uuid,boolean,jsonb)') as rpc;  -- null


-- =====================================================================
-- 1) Catálogo de eventos (create or replace mantém o ACL: função interna,
--    sem EXECUTE para anon/authenticated)
-- =====================================================================
create or replace function public.projeto_evento_log(p_projeto_id uuid, p_requisicao_id uuid, p_evento text, p_fase text default null::text, p_valor_antes numeric default null::numeric, p_valor_depois numeric default null::numeric, p_detalhes jsonb default null::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_eventos constant text[] := array[
    'pedido_criado', 'pedido_editado', 'pedido_excluido',
    'pedido_enviado_alvo', 'teto_rejeitado',
    'budget_enviado_aprovacao', 'budget_aprovado',
    'pedido_enviado_aprovacao', 'pedido_aprovacao_falhou'                    -- L10
  ];
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
begin
  if p_evento is null or not (p_evento = any (c_eventos)) then
    raise exception 'Evento desconhecido: "%". Permitidos: %',
      coalesce(p_evento, '<null>'), array_to_string(c_eventos, ', ')
      using errcode = '22023';
  end if;

  begin
    select pr.email into v_email
      from public.profiles pr
     where pr.user_id = v_uid;
  exception when others then
    v_email := null;
  end;

  insert into public.projeto_eventos (
    projeto_id, requisicao_id, evento, fase,
    valor_antes, valor_depois, detalhes, usuario_id, usuario_email
  ) values (
    p_projeto_id, p_requisicao_id, p_evento, p_fase,
    p_valor_antes, p_valor_depois, p_detalhes, v_uid, v_email
  ) returning id into v_id;

  return v_id;
end;
$function$;


-- =====================================================================
-- 2) Registro do comando de aprovação
--    Quem pode: admin, ou responsável do projeto com projetos.pedidos.create
--    ou projetos.pedidos.reenviar (a mesma regra de quem envia ao ERP).
--    Só para pedido já enviado ao Alvo (status 'enviado' com número).
-- =====================================================================
create or replace function public.projeto_pedido_registrar_aprovacao(
  p_id       uuid,
  p_sucesso  boolean,
  p_detalhes jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_req    record;
  v_evento uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  select r.id, r.projeto_id, r.fase, r.status, r.numero_pedido_alvo, r.valor_total, pr.responsavel_id
    into v_req
    from public.projeto_requisicoes r
    join public.projetos pr on pr.id = r.projeto_id
   where r.id = p_id;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;

  if not (public._is_admin()
          or ((public._user_has_perm('projetos.pedidos.create') or public._user_has_perm('projetos.pedidos.reenviar'))
              and v_req.responsavel_id = auth.uid())) then
    raise exception 'Sem permissão para enviar este pedido para aprovação.' using errcode = '42501';
  end if;

  if v_req.status <> 'enviado' or v_req.numero_pedido_alvo is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'pedido_nao_enviado',
                              'mensagem', 'O pedido ainda não está registrado como enviado ao ERP.');
  end if;

  -- p_sucesso null = PRÉ-VOO: o front confere permissão e estado aqui ANTES de
  -- mandar o comando ao Alvo (o gateway só exige login, não a permissão do Hub).
  if p_sucesso is null then
    return jsonb_build_object('success', true, 'pre_voo', true, 'numero', v_req.numero_pedido_alvo);
  end if;

  v_evento := public.projeto_evento_log(
    v_req.projeto_id, v_req.id,
    case when coalesce(p_sucesso, false) then 'pedido_enviado_aprovacao' else 'pedido_aprovacao_falhou' end,
    v_req.fase, null, v_req.valor_total,
    coalesce(p_detalhes, '{}'::jsonb) || jsonb_build_object('numero', v_req.numero_pedido_alvo)
  );

  return jsonb_build_object('success', true, 'evento_id', v_evento);
end;
$$;

revoke execute on function public.projeto_pedido_registrar_aprovacao(uuid, boolean, jsonb) from anon, public;
grant execute on function public.projeto_pedido_registrar_aprovacao(uuid, boolean, jsonb) to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- 3) VERIFICAÇÃO POR LEITURA (rodar separado)
-- =====================================================================
-- select
--   position('pedido_enviado_aprovacao' in (select prosrc from pg_proc
--     where oid = 'public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb)'::regprocedure)) > 0 as catalogo_ok,
--   has_function_privilege('anon', 'public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb)', 'EXECUTE') as anon_log,          -- false
--   has_function_privilege('authenticated', 'public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb)', 'EXECUTE') as auth_log, -- false
--   has_function_privilege('anon', 'public.projeto_pedido_registrar_aprovacao(uuid,boolean,jsonb)', 'EXECUTE') as anon_rpc,                 -- false
--   has_function_privilege('authenticated', 'public.projeto_pedido_registrar_aprovacao(uuid,boolean,jsonb)', 'EXECUTE') as auth_rpc;        -- true
