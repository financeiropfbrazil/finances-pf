-- =====================================================================
-- NFSE-1.3 — RPCs de leitura das NFS-e recebidas (PLANO-NFSE.md §3, Fase 1) — 19/10/2026
-- Projeto: hbtggrbauguukewiknew. Gate: _is_admin() or user_has_permission(auth.uid(), 'compras.nfse.access').
--   nfse_recebidas_listar(...) → jsonb {total, atualizado_em, indicadores, itens[]} (lê v_nfse_recebida)
--   nfse_recebida_xml(chave)   → XML da nota (download)
-- A nfse_alvo_sem_fisco (sentido inverso, prevista na 1.3) fica para depois — ver o ajuste no plano.
-- Objetos novos. Rollback: NFSE-1.3-rollback.sql.
-- =====================================================================

-- ── Pré-voo ──────────────────────────────────────────────────────────
-- select to_regclass('public.v_nfse_recebida');                                        -- deve existir (NFSE-1.2)
-- select to_regprocedure('public.nfse_recebidas_listar(date,date,text,text[],text[],text,integer,integer)'); -- NULL
-- select to_regprocedure('public.nfse_recebida_xml(text)');                              -- NULL

create function public.nfse_recebidas_listar(
  p_de date,
  p_ate date,
  p_busca text default null,
  p_fisco text[] default null,
  p_alvo text[] default null,
  p_cmun text default null,
  p_limit integer default 500,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_busca  text    := nullif(btrim(p_busca), '');
  v_digitos text   := nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), '');
  v_res    jsonb;
begin
  if not (public._is_admin() or public.user_has_permission(auth.uid(), 'compras.nfse.access')) then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;

  with base as (
    select v.*
    from public.v_nfse_recebida v
    where v.data_emissao between p_de and p_ate
      and (p_cmun is null or v.cmun_emissor = p_cmun)
      and (v_busca is null
           or v.prestador_nome ilike '%' || v_busca || '%'
           or v.numero ilike '%' || v_busca || '%'
           or (v_digitos is not null and v.prestador_doc like '%' || v_digitos || '%'))
  ),
  filtrada as (
    select b.* from base b
    where (p_fisco is null or b.situacao_fisco = any(p_fisco))
      and (p_alvo is null or b.situacao_alvo = any(p_alvo))
  ),
  pagina as (
    select f.* from filtrada f
    order by f.data_emissao desc, f.prestador_nome, f.numero
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'atualizado_em', (select max(r.finished_at) from public.sync_runs r where r.job_type = 'nfse_adn'),
    'indicadores', (
      select jsonb_build_object(
        'recebidas', count(*),
        'valor', coalesce(sum(b.valor_servico), 0),
        'lancadas', count(*) filter (where b.situacao_alvo <> 'nao_lancada'),
        'nao_lancadas', count(*) filter (where b.situacao_alvo = 'nao_lancada' and b.situacao_fisco = 'normal'),
        'nao_lancadas_15d', count(*) filter (where b.situacao_alvo = 'nao_lancada' and b.situacao_fisco = 'normal'
                                              and b.dias_desde_emissao > 15),
        'nao_lancadas_15d_valor', coalesce(sum(b.valor_servico) filter (where b.situacao_alvo = 'nao_lancada'
                                              and b.situacao_fisco = 'normal' and b.dias_desde_emissao > 15), 0),
        'canceladas', count(*) filter (where b.situacao_fisco <> 'normal'),
        'canceladas_e_lancadas', count(*) filter (where b.situacao_fisco <> 'normal' and b.situacao_alvo <> 'nao_lancada')
      )
      from base b
    ),
    'itens', coalesce((select jsonb_agg(to_jsonb(p) order by p.data_emissao desc, p.prestador_nome, p.numero) from pagina p),
                      '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;

comment on function public.nfse_recebidas_listar(date, date, text, text[], text[], text, integer, integer) is
  'NFSE-1.3: NFS-e recebidas (v_nfse_recebida) do período, com filtros pelos dois eixos (fisco, alvo), busca e '
  'município emissor. Indicadores sobre o período + busca (sem os filtros de eixo). Gate compras.nfse.access.';

create function public.nfse_recebida_xml(p_chave text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_xml text;
begin
  if not (public._is_admin() or public.user_has_permission(auth.uid(), 'compras.nfse.access')) then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;
  select d.xml into v_xml
  from public.nfse_adn_doc d
  where d.chave_acesso = p_chave and d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador'
  order by d.nsu desc
  limit 1;
  return v_xml;
end;
$function$;

comment on function public.nfse_recebida_xml(text) is
  'NFSE-1.3: XML da NFS-e (P&F tomadora) pela chave de acesso, para download. Gate compras.nfse.access.';

-- Toda função nova em public nasce com EXECUTE nominal para anon (CLAUDE.md): revogar com a assinatura completa.
revoke execute on function public.nfse_recebidas_listar(date, date, text, text[], text[], text, integer, integer) from anon;
revoke execute on function public.nfse_recebidas_listar(date, date, text, text[], text[], text, integer, integer) from public;
grant execute on function public.nfse_recebidas_listar(date, date, text, text[], text[], text, integer, integer) to authenticated;
revoke execute on function public.nfse_recebida_xml(text) from anon;
revoke execute on function public.nfse_recebida_xml(text) from public;
grant execute on function public.nfse_recebida_xml(text) to authenticated;
