-- =====================================================================
-- PROJ-L2.3 — projeto_pedido_marcar_enviado   (CORRECAO DE BUG, nao padronizacao)
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L2.5) · achado A-2 · decisoes D-7 e D-8
--
-- ESTADO: PENDENTE de aplicacao (bloco 3/4).
--
-- PRE-REQUISITOS: PROJ-L1, PROJ-L2.0
--
-- O BUG QUE ESTA FUNCAO MATA (achado A-2 do L0):
--   src/services/alvoProjetoPedidoService.ts:355 e :387 gravam o pos-envio ao
--   Alvo via .upsert() — a MESMA construcao da causa-raiz do 42501. Para
--   nao-admin em fase='actual' a WITH CHECK da policy de INSERT rejeita: o
--   pedido ENTRA NO ERP e o Hub NAO registra numero_pedido_alvo/status.
--   A funcao retorna success:true com o erro escondido em `error`, e o catch
--   que gravaria status='erro' falha pelo mesmo motivo. Divergencia silenciosa
--   Hub x ERP. So nao estourou ainda porque quem enviou foi o admin.
--
-- COBERTURA 1:1 dos campos mapeados na secao 10.7 do plano:
--   sucesso: status, numero_pedido_alvo, enviado_em, erro_envio=null,
--            bloqueado=true, enviado_alvo_em, enviado_alvo_por, updated_at
--   falha:   status='erro', erro_envio, updated_at
--            (nao mexe em numero_pedido_alvo nem bloqueado — paridade)
--
--   D-8: enviado_alvo_por recebe o USUARIO REAL (e-mail via profiles.user_id,
--        fallback uuid). Nunca mais o literal "sistema".
-- =====================================================================

drop function if exists public.projeto_pedido_marcar_enviado(uuid, text, boolean, text);

create or replace function public.projeto_pedido_marcar_enviado(
  p_id          uuid,
  p_numero_alvo text,
  p_sucesso     boolean,
  p_erro        text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_evt  constant text := 'pedido_enviado_alvo';
  c_perm constant text := 'projetos.pedidos.create';
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_row      public.projeto_requisicoes%rowtype;
  v_new      public.projeto_requisicoes%rowtype;
  v_proj     public.projetos%rowtype;
  v_numero   text := nullif(btrim(coalesce(p_numero_alvo,'')), '');
  v_quem     text;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  v_is_admin := public._is_admin();

  select * into v_row from public.projeto_requisicoes where id = p_id for update;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;

  select * into v_proj from public.projetos where id = v_row.projeto_id for update;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if not public._user_has_perm(c_perm) then
      raise exception 'Sem permissão para gerenciar pedidos de projeto (%)', c_perm
        using errcode = '42501';
    end if;
    if v_proj.responsavel_id is distinct from v_uid then
      raise exception 'Apenas o responsável do projeto pode registrar envio ao Alvo'
        using errcode = '42501';
    end if;
  end if;

  -- defesa em profundidade: espelha o gate P7 do service (so Actual vai ao ERP)
  if v_row.fase <> 'actual' then
    raise exception 'Apenas pedidos da fase Actual podem ser enviados ao ERP (fase: "%")',
      v_row.fase using errcode = '22023';
  end if;

  -- nunca sobrescrever um numero de pedido ja registrado por outro diferente
  if p_sucesso and v_row.numero_pedido_alvo is not null
     and v_numero is distinct from v_row.numero_pedido_alvo then
    raise exception 'Pedido já registrado no Alvo com o número % — recebido %',
      v_row.numero_pedido_alvo, coalesce(v_numero, '<null>') using errcode = '22023';
  end if;

  -- D-8: usuario real. Nunca o literal "sistema". (profiles.user_id — §2.4)
  select pr.email into v_quem from public.profiles pr where pr.user_id = v_uid;
  v_quem := coalesce(v_quem, v_uid::text);

  if p_sucesso then
    update public.projeto_requisicoes set
      status             = 'enviado',
      numero_pedido_alvo = v_numero,
      enviado_em         = now(),
      erro_envio         = null,
      bloqueado          = true,
      enviado_alvo_em    = now(),
      enviado_alvo_por   = v_quem,
      atualizado_por     = v_uid,
      updated_at         = now()
     where id = p_id
    returning * into v_new;
  else
    -- paridade com o comportamento atual: nao mexe em numero_pedido_alvo nem bloqueado
    update public.projeto_requisicoes set
      status         = 'erro',
      erro_envio     = p_erro,
      atualizado_por = v_uid,
      updated_at     = now()
     where id = p_id
    returning * into v_new;
  end if;

  perform public.projeto_evento_log(
    v_row.projeto_id, v_new.id, c_evt, v_new.fase, null, v_new.valor_total,
    jsonb_build_object('sucesso', p_sucesso,
                       'numero_pedido_alvo', v_new.numero_pedido_alvo,
                       'erro', p_erro,
                       'enviado_alvo_por', v_quem)
  );

  return jsonb_build_object('success', true, 'pedido', to_jsonb(v_new));
end;
$function$;

revoke all     on function public.projeto_pedido_marcar_enviado(uuid,text,boolean,text) from public, anon;
grant  execute on function public.projeto_pedido_marcar_enviado(uuid,text,boolean,text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verificacao por leitura
--
-- ATENCAO (licao de 07/08): NAO usar `ilike '%sistema%'` aqui.
--   pg_get_functiondef devolve o corpo COM OS COMENTARIOS, e o comentario do
--   D-8 acima cita a palavra "sistema" — a checagem por mencao deu FALSO
--   POSITIVO na primeira aplicacao. A checagem correta e pela ATRIBUICAO.
select p.proname,
       pg_get_function_identity_arguments(p.oid)                 as assinatura,
       p.prosecdef                                               as security_definer,
       p.proconfig::text                                         as search_path,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_executa,
       has_function_privilege('anon',          p.oid, 'EXECUTE')  as anon_executa,
       (pg_get_functiondef(p.oid) ilike '%projeto_evento_log%')   as chama_evento_log,
       (pg_get_functiondef(p.oid) ~* $re$enviado_alvo_por\s*=\s*'sistema'$re$) as grava_literal_sistema,
       (pg_get_functiondef(p.oid) ~* $re$enviado_alvo_por\s*=\s*v_quem$re$)    as grava_usuario_real
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='projeto_pedido_marcar_enviado';
-- Esperado: true | {"search_path=public, auth"} | true | false | true | FALSE | TRUE
--   D-8 cumprida  <=>  grava_literal_sistema = false  E  grava_usuario_real = true

-- Se quiser ver de onde vem qualquer mencao a "sistema" no corpo (deve ser so
-- o comentario do D-8):
--   select l.nro, l.linha
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
--          lateral unnest(string_to_array(pg_get_functiondef(p.oid), chr(10)))
--            with ordinality as l(linha, nro)
--    where n.nspname='public' and p.proname='projeto_pedido_marcar_enviado'
--      and l.linha ilike '%sistema%';

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.projeto_pedido_marcar_enviado(uuid,text,boolean,text);
-- =====================================================================
