-- =====================================================================
-- NFSE-1.2-A — Correção (19/10/2026, achada no diagnóstico do cron; OK do Pedro em 20/10/2026)
-- Projeto: hbtggrbauguukewiknew.
-- Problema: o espelho fin_parcelas_pagar só tem títulos com vencimento a partir de 01/01/2026. Nota emitida antes
--   disso e não achada aparecia "nao_lancada" (≈ 235 notas de 2023–2025) sem que o Hub soubesse.
-- Solução: situacao_alvo ganha o valor 'sem_dado_alvo' (nota não achada emitida antes do menor vencimento do
--   espelho — calculado, não fixo). A RPC nfse_recebidas_listar passa a contar como lançadas só
--   lancada_nfse/lancada_outra_especie, ganha o indicador sem_dado_alvo e devolve alvo_espelho_desde.
-- create or replace: mesmas colunas da view, mesmo ACL das duas. Rollback: NFSE-1.2-A-rollback.sql (DDL anterior).
-- =====================================================================

-- ── Pré-voo ──────────────────────────────────────────────────────────
-- select count(*) from public.compras_pedidos;                -- ≈ 2.310 em 20/10/2026
-- select min(data_vencimento) from public.fin_parcelas_pagar;  -- 2026-01-01 em 20/10/2026

create or replace view public.v_nfse_recebida with (security_invoker = on) as
with nota as (
  select d.nsu, d.chave_acesso, d.numero, ltrim(d.numero, '0') as num, d.data_emissao,
         d.prestador_doc,
         replace(d.prestador_nome, '&amp;', '&') as prestador_nome,
         d.cmun_emissor,
         nullif(btrim(replace(substring(d.xml from '<xLocEmi>([^<]*)</xLocEmi>'), '&amp;', '&')), '') as municipio_emissor,
         d.tomador_doc, d.intermediario_doc, d.valor_servico, d.valor_liquido, d.gerado_em
  from public.nfse_adn_doc d
  where d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador'
),
evento as (
  select e.chave_acesso,
         bool_or(e.tipo_evento = 'CANCELAMENTO_POR_SUBSTITUICAO') as substituida,
         max(e.gerado_em) as cancelada_em
  from public.nfse_adn_doc e
  where e.tipo_documento = 'EVENTO' and e.tipo_evento in ('CANCELAMENTO', 'CANCELAMENTO_POR_SUBSTITUICAO')
  group by e.chave_acesso
),
limite as (
  -- O espelho do contas a pagar só tem títulos com vencimento a partir desta data (19/10/2026: 01/01/2026).
  -- Nota não achada e emitida antes dela: o Hub não sabe se foi lançada → sem_dado_alvo, não nao_lancada.
  select min(f.data_vencimento) as inicio from public.fin_parcelas_pagar f
),
titulo as (
  select f.cpf_cnpj_entidade as cnpj, ltrim(f.doc_numero, '0') as num,
         bool_or(f.especie = 'NFS-e') as tem_nfse,
         string_agg(distinct f.especie, ', ') as especies,
         min(f.chave_docfin) as chave_docfin,
         min(f.chave_movestq) as chave_movestq,
         min(f.data_entrada) as data_entrada,
         sum(f.valor_original) as valor,
         count(*) as parcelas,
         count(*) filter (where c.classe in ('pago', 'quitado_adto')) as pagas,
         count(*) filter (where c.classe = 'aberto') as abertas,
         count(*) filter (where c.classe = 'agrupado') as agrupadas,
         min(f.pedido_numero) as pedido_titulo
  from public.fin_parcelas_pagar f
  cross join lateral (select public.rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca) as classe) c
  where f.ausente_no_alvo_em is null
  group by f.cpf_cnpj_entidade, ltrim(f.doc_numero, '0')
)
select n.nsu, n.chave_acesso, n.numero, n.data_emissao, n.prestador_doc, n.prestador_nome,
       n.cmun_emissor, n.municipio_emissor, n.tomador_doc, n.intermediario_doc, n.valor_servico, n.valor_liquido,
       n.gerado_em,
       case when ev.chave_acesso is null then 'normal' when ev.substituida then 'substituida' else 'cancelada' end as situacao_fisco,
       ev.cancelada_em,
       case when t.tem_nfse then 'lancada_nfse'
            when t.cnpj is not null then 'lancada_outra_especie'
            when n.data_emissao < (select l.inicio from limite l) then 'sem_dado_alvo'
            else 'nao_lancada' end as situacao_alvo,
       t.especies as alvo_especies,
       t.chave_docfin as alvo_chave_docfin,
       t.chave_movestq as alvo_chave_movestq,
       t.data_entrada as alvo_data_entrada,
       t.valor as alvo_valor,
       t.parcelas as alvo_parcelas,
       case when t.parcelas is null then null
            when t.pagas = t.parcelas then 'pago'
            when t.abertas = t.parcelas then 'em_aberto'
            when t.abertas > 0 then 'parcial'
            when t.agrupadas > 0 then 'agrupado'
            else 'baixa_sem_prova' end as alvo_pagamento,
       coalesce((select string_agg(distinct p.pedido_numero, ', ')
                 from public.rastreio_nf_pedido p
                 where p.chave_movestq = t.chave_movestq and p.codigo_empresa_filial = '1.01'),
                t.pedido_titulo) as alvo_pedido,
       (current_date - n.data_emissao) as dias_desde_emissao
from nota n
left join evento ev on ev.chave_acesso = n.chave_acesso
left join titulo t on t.cnpj = n.prestador_doc and t.num = n.num
;

create or replace function public.nfse_recebidas_listar(
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
    'alvo_espelho_desde', (select min(f.data_vencimento) from public.fin_parcelas_pagar f),
    'indicadores', (
      select jsonb_build_object(
        'recebidas', count(*),
        'valor', coalesce(sum(b.valor_servico), 0),
        'lancadas', count(*) filter (where b.situacao_alvo in ('lancada_nfse', 'lancada_outra_especie')),
        'nao_lancadas', count(*) filter (where b.situacao_alvo = 'nao_lancada' and b.situacao_fisco = 'normal'),
        'nao_lancadas_15d', count(*) filter (where b.situacao_alvo = 'nao_lancada' and b.situacao_fisco = 'normal'
                                              and b.dias_desde_emissao > 15),
        'nao_lancadas_15d_valor', coalesce(sum(b.valor_servico) filter (where b.situacao_alvo = 'nao_lancada'
                                              and b.situacao_fisco = 'normal' and b.dias_desde_emissao > 15), 0),
        'canceladas', count(*) filter (where b.situacao_fisco <> 'normal'),
        'canceladas_e_lancadas', count(*) filter (where b.situacao_fisco <> 'normal'
                                                   and b.situacao_alvo in ('lancada_nfse', 'lancada_outra_especie')),
        'sem_dado_alvo', count(*) filter (where b.situacao_alvo = 'sem_dado_alvo')
      )
      from base b
    ),
    'itens', coalesce((select jsonb_agg(to_jsonb(p) order by p.data_emissao desc, p.prestador_nome, p.numero) from pagina p),
                      '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;
