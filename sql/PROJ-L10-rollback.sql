-- =====================================================================
-- PROJ-L10 — ROLLBACK (colar no SQL Editor; tem DROP, não vai pelo MCP)
-- 1) volta o catálogo de eventos ao anterior ao L10 (os eventos já gravados
--    ficam na tabela — só não se gravam novos);
-- 2) remove a RPC de registro.
-- Corpo abaixo = fonte EXATA anterior ao L10:
--   md5(replace(prosrc, E'\r\n', E'\n')) = b0def584c2e3079e4d6e704a03a8f3ce
-- =====================================================================
begin;

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
    'budget_enviado_aprovacao', 'budget_aprovado'
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

drop function if exists public.projeto_pedido_registrar_aprovacao(uuid, boolean, jsonb);

commit;

notify pgrst, 'reload schema';
