-- =====================================================================
-- NFSE-1.2 — View v_nfse_recebida (PLANO-NFSE.md §3, Fase 1) — 19/10/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (19/10): "faça a irmã de NF de Serviços".
--
-- 1 linha por NFS-e do ADN com a P&F TOMADORA, com os dois eixos sempre separados (D6):
--   situacao_fisco: normal / cancelada / substituida   (eventos do ADN pela chave de acesso)
--   situacao_alvo : lancada_nfse / lancada_outra_especie / nao_lancada
--                   (regra da NFSE-0.6: CNPJ do prestador + doc_numero sem zeros em fin_parcelas_pagar,
--                    ignorando título excluído no Alvo — ausente_no_alvo_em)
-- Pagamento do título: rastreio_classe_pagamento ("pago só com prova", LR-PAG F1).
-- Pedido: rastreio_nf_pedido pela chave do MovEstq do título; senão, pedido_numero do título.
-- Nome do município emissor: xLocEmi do XML (sem tabela de IBGE). Nome do prestador com o
-- &amp; duplo da origem (NFSE-0.5) desfeito.
-- security_invoker = on + sem acesso de anon/authenticated: só as RPCs da NFSE-1.3 leem.
-- Objeto novo. Rollback: NFSE-1.2-rollback.sql.
-- =====================================================================

-- ── Pré-voo ──────────────────────────────────────────────────────────
-- select count(*) from public.compras_pedidos;          -- ≈ 2.305 em 19/10/2026
-- select to_regclass('public.v_nfse_recebida');          -- deve ser NULL

create view public.v_nfse_recebida with (security_invoker = on) as
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
       case when t.tem_nfse then 'lancada_nfse' when t.cnpj is not null then 'lancada_outra_especie' else 'nao_lancada' end as situacao_alvo,
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

comment on view public.v_nfse_recebida is
  'NFSE-1.2 (PLANO-NFSE.md): 1 linha por NFS-e do ADN com a P&F tomadora. situacao_fisco = o que o FISCO diz '
  '(eventos do ADN); situacao_alvo = o que o ALVO tem (fin_parcelas_pagar, regra da NFSE-0.6). Lida só pelas RPCs '
  'nfse_recebidas_listar / nfse_recebida_xml.';

revoke all on public.v_nfse_recebida from public, anon, authenticated;
grant select on public.v_nfse_recebida to service_role;
