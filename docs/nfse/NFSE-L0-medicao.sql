-- NFSE-L0 — Medições da investigação "lançamento de NFS-e buscando pedido de compra" (19/10/2026)
-- SOMENTE LEITURA. Rodar no projeto hbtggrbauguukewiknew (fingerprint: count(*) de compras_pedidos ≈ 2.305 em 19/10/2026).
-- Fontes: nfse_adn_doc (fisco/ADN), rastreio_nf + rastreio_nf_pedido (espelho do Alvo: NF e pedido ligado),
--         desp_realizado_doc.payload_alvo (MovEstq/Load das NFS-e lançadas, congelado desde 06/10), compras_pedidos.

-- 0. Fingerprint
select count(*) as compras_pedidos from compras_pedidos;

-- 1. NFS-e lançadas no Alvo por mês e tipo de lançamento, com e sem pedido ligado (2026)
--    19/10: E0000091 ≈ 115–125 NFS-e/mês; 82–92% com pedido ligado, conforme o mês.
with nf as (
  select r.chave_movestq, r.codigo_tipo_lanc, r.data_entrada, r.valor_documento,
         exists (select 1 from rastreio_nf_pedido p
                  where p.chave_movestq = r.chave_movestq and p.codigo_empresa_filial = '1.01') as com_ped
  from rastreio_nf r
  where r.codigo_empresa_filial = '1.01' and r.operacao = 'Entrada' and r.especie = 'NFS-e'
    and r.data_entrada >= '2026-01-01'
)
select to_char(data_entrada, 'YYYY-MM') as mes, codigo_tipo_lanc, count(*) as nfs,
       sum(com_ped::int) as com_pedido, round(100.0 * sum(com_ped::int) / count(*), 1) as pct
from nf group by 1, 2 order by 1, 3 desc;

-- 2. Como o pedido se relaciona com a NFS-e (E0000091, 2026)
--    19/10: 1.071 NFS-e E0000091 em 2026, 916 com pedido (86%) → 930 vínculos, 546 pedidos. Dos vínculos: pedido fora do Hub
--    105 (11%) · pedido de outro fornecedor 40 (4%) · valor igual ao do pedido 291 (31%) · em pedido com 4+ NFs 357 (38%)
--    · pedido implantado depois da emissão 207 (22%).
with nf as (
  select r.chave_movestq, r.data_emissao, r.valor_documento, r.codigo_entidade
  from rastreio_nf r
  where r.codigo_empresa_filial = '1.01' and r.operacao = 'Entrada' and r.especie = 'NFS-e'
    and r.codigo_tipo_lanc = 'E0000091' and r.data_entrada >= '2026-01-01'
), lk as (
  select n.*, p.pedido_numero, cp.codigo_entidade as ped_ent, cp.valor_total as ped_valor,
         (cp.data_digitacao_alvo at time zone 'America/Sao_Paulo')::date as ped_impl,
         count(*) over (partition by p.pedido_numero) as nfs_no_pedido
  from nf n
  join rastreio_nf_pedido p on p.chave_movestq = n.chave_movestq and p.codigo_empresa_filial = '1.01'
  left join compras_pedidos cp on cp.numero = p.pedido_numero and cp.codigo_empresa_filial = '1.01'
)
select count(*) as vinculos, count(distinct chave_movestq) as nfs, count(distinct pedido_numero) as pedidos,
       count(*) filter (where ped_ent is null) as pedido_fora_do_hub,
       count(*) filter (where ped_ent = codigo_entidade) as mesmo_fornecedor,
       count(*) filter (where ped_ent is not null and ped_ent <> codigo_entidade) as outro_fornecedor,
       count(*) filter (where abs(ped_valor - valor_documento) <= 0.05) as valor_igual_ao_pedido,
       count(*) filter (where nfs_no_pedido >= 4) as em_pedido_com_4_ou_mais_nfs,
       count(*) filter (where ped_impl > data_emissao) as pedido_implantado_depois_da_emissao
from lk;

-- 3. Simulação do casamento automático contra o vínculo real (NFS-e do ADN emitidas jun–set/2026)
--    Candidatos: mesmo CNPJ, pedido não cancelado/excluído, data do pedido em [emissão-400, emissão+30].
--    Saldo = valor do pedido − NFs já ligadas a ele com entrada anterior.
--    R1 pedido citado no texto da NFS-e (xDescServ/xInfComp) · R2 único com saldo · R3 valor exato entre os com saldo.
--    19/10 (385 NFS-e com pedido no Alvo): R1 57 (55 certas) · R2 com saldo exato 48 (48) · R2 com saldo parcial 66 (50)
--    · R3 68 (56) · sem regra 146. Nível A (R1 + R2 exato) = 105 NFs, 103 certas (98%). Cobertura total 62%, precisão 87%.
with ent as (
  select distinct on (codigo_entidade) codigo_entidade, regexp_replace(cnpj, '\D', '', 'g') as cnpj
  from compras_entidades_cache where cnpj is not null order by codigo_entidade, updated_at desc
), ped as (
  select cp.numero, coalesce(nullif(regexp_replace(cp.cnpj_entidade, '\D', '', 'g'), ''), pe.cnpj) as cnpj,
         cp.data_pedido, cp.valor_total
  from compras_pedidos cp left join ent pe on pe.codigo_entidade = cp.codigo_entidade
  where cp.numero not like 'RASCUNHO%' and coalesce(cp.status, '') <> 'Cancelado'
    and cp.status_local::text <> 'excluido_alvo'
), lan as (
  select r.chave_movestq, ltrim(r.numero, '0') as num, e.cnpj, r.data_entrada, r.valor_documento, p.pedido_numero
  from rastreio_nf r join ent e on e.codigo_entidade = r.codigo_entidade
  join rastreio_nf_pedido p on p.chave_movestq = r.chave_movestq and p.codigo_empresa_filial = '1.01'
  where r.codigo_empresa_filial = '1.01' and r.operacao = 'Entrada' and r.especie = 'NFS-e'
), adn as (
  select a.chave_acesso, ltrim(a.numero, '0') as num, a.prestador_doc as cnpj, a.data_emissao, a.valor_servico as v,
         coalesce(substring(a.xml from '<xDescServ>(.*?)</xDescServ>'), '') || ' ' ||
         coalesce(substring(a.xml from '<xInfComp>(.*?)</xInfComp>'), '') as txt
  from nfse_adn_doc a
  where a.tipo_documento = 'NFSE' and a.papel_pf = 'tomador' and a.data_emissao between '2026-06-01' and '2026-09-30'
), alvo1 as (select distinct chave_movestq, num, cnpj, data_entrada from lan),
truth as (
  select adn.*, al.data_entrada,
         (select array_agg(distinct l.pedido_numero) from lan l where l.chave_movestq = al.chave_movestq) as verdade
  from adn join alvo1 al on al.cnpj = adn.cnpj and al.num = adn.num
), cited as (
  select distinct t.chave_acesso, lpad(m[1], 7, '0') as numero
  from truth t, regexp_matches(t.txt, '(?<!\d)(000\d{4}|[1-9]\d{3})(?!\d)', 'g') m
), cand as (
  select t.chave_acesso, p.numero, p.valor_total,
         p.valor_total - coalesce((select sum(l.valor_documento) from lan l
                                    where l.pedido_numero = p.numero and l.data_entrada < t.data_entrada), 0) as saldo,
         exists (select 1 from cited c where c.chave_acesso = t.chave_acesso and c.numero = p.numero) as citado
  from truth t join ped p on p.cnpj = t.cnpj and p.data_pedido between t.data_emissao - 400 and t.data_emissao + 30
), agg as (
  select t.chave_acesso, t.verdade,
         array_agg(c.numero) filter (where c.citado) as citados,
         array_agg(c.numero) filter (where c.saldo >= t.v - 0.05) as com_saldo,
         array_agg(c.numero) filter (where c.saldo >= t.v - 0.05 and abs(c.saldo - t.v) <= 0.05) as saldo_exato,
         array_agg(c.numero) filter (where c.saldo >= t.v - 0.05 and abs(c.valor_total - t.v) <= 0.05) as valor_exato
  from truth t left join cand c on c.chave_acesso = t.chave_acesso
  where t.verdade is not null group by 1, 2
), escolha as (
  select *,
    case when cardinality(citados) = 1 then 'R1 citado'
         when cardinality(com_saldo) = 1 then 'R2 unico com saldo'
         when cardinality(valor_exato) = 1 then 'R3 valor exato'
         else 'manual' end as regra,
    case when cardinality(citados) = 1 then citados[1]
         when cardinality(com_saldo) = 1 then com_saldo[1]
         when cardinality(valor_exato) = 1 then valor_exato[1] end as escolhido,
    (cardinality(citados) = 1
     or (coalesce(cardinality(citados), 0) <> 1 and cardinality(com_saldo) = 1 and cardinality(saldo_exato) = 1)) as nivel_a
  from agg
)
select regra, nivel_a, count(*) as nfs,
       count(*) filter (where escolhido = any(verdade)) as acertos,
       count(*) filter (where escolhido is not null and not (escolhido = any(verdade))) as erros
from escolha group by 1, 2 order by 1, 2;

-- 4. A NFS-e copia o pedido? (itens E0000091 de 2026 com pedido presente no Hub)
--    19/10: produto do item = produto do pedido 99% · classe 99% · centro de custo 97% · PIS/COFINS/CSLL retidos em 88% dos itens.
with it as (
  select d.chave_movestq, i,
         d.payload_alvo -> 'MovEstqClasseRecDespChildList' -> 0 ->> 'CodigoClasseRecDesp' as classe_nf,
         d.payload_alvo -> 'MovEstqClasseRecDespChildList' -> 0 -> 'RateioMovEstqChildList' -> 0 ->> 'CodigoCentroCtrl' as cc_nf
  from desp_realizado_doc d,
       jsonb_array_elements(case when jsonb_typeof(d.payload_alvo -> 'ItemMovEstqChildList') = 'array'
                                 then d.payload_alvo -> 'ItemMovEstqChildList' else '[]'::jsonb end) i
  where d.codigo_tipo_lanc = 'E0000091' and d.especie = 'NFS-e' and d.codigo_empresa_filial = '1.01'
    and d.data_movimento >= '2026-01-01'
), j as (
  select it.*, cp.classe_rec_desp as classe_ped, cp.centro_custo as cc_ped,
         (select string_agg(pi.codigo_produto, ',') from compras_pedidos_itens pi where pi.pedido_id = cp.id) as prods_ped
  from it left join compras_pedidos cp on cp.numero = it.i ->> 'NumeroPedComp' and cp.codigo_empresa_filial = '1.01'
)
select count(*) as itens_2026,
       count(*) filter (where (i ->> 'ValorPISRF')::numeric > 0) as pis_cofins_csll_retidos,
       count(*) filter (where (i ->> 'ValorIRRF')::numeric > 0) as irrf,
       count(*) filter (where (i ->> 'ValorINSS')::numeric > 0) as inss,
       count(*) filter (where (i ->> 'ValorISS')::numeric > 0) as iss,
       count(*) filter (where classe_ped is not null) as pedido_no_hub,
       count(*) filter (where classe_ped is not null and position(i ->> 'CodigoProduto' in coalesce(prods_ped, '')) > 0) as produto_igual,
       count(*) filter (where classe_ped is not null and classe_nf = classe_ped) as classe_igual,
       count(*) filter (where classe_ped is not null and cc_nf = cc_ped) as cc_igual
from j;

-- 5. Retenções declaradas no XML do ADN (tags presentes nas NFS-e tomador desde jun/2026)
--    19/10: retenções federais declaradas em só ~14–24% dos XMLs (conforme a tag); <xPed> em nenhum.
select t, count(*) from (
  select distinct a.chave_acesso, m[1] as t
  from nfse_adn_doc a, regexp_matches(a.xml, '<(vRetCSLL|vRetIRRF|vRetCP|vPis|vCofins|tpRetPisCofins|tpRetISSQN|vISSQN|xPed|xInfComp)>', 'g') m
  where a.tipo_documento = 'NFSE' and a.papel_pf = 'tomador' and a.data_emissao >= '2026-06-01'
) s group by t order by 2 desc;

-- 6. Atraso de lançamento pelo método da NFSE-0.6 (ADN tomador × fin_parcelas_pagar por CNPJ + número)
--    19/10: desde 01/07 → 123 não lançadas (R$ 513.587,14); > 15 dias → 76 (R$ 244.925,68).
--    Conciliação com a 0.6 (16/10: 39 / R$ 113.154,39): 35 das 39 seguem sem lançar e as 27 emitidas em 01–03/10
--    (R$ 133.577,12) passaram dos 15 dias com a janela andando 3 dias (concentração de emissão no início do mês).
with adn as (
  select d.prestador_doc cnpj, ltrim(d.numero, '0') num, d.data_emissao, d.valor_servico,
         exists (select 1 from nfse_adn_doc ev where ev.tipo_documento = 'EVENTO' and ev.chave_acesso = d.chave_acesso
                   and ev.tipo_evento in ('CANCELAMENTO', 'CANCELAMENTO_POR_SUBSTITUICAO')) cancelada
  from nfse_adn_doc d where d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador'),
alvo_qq as (select cpf_cnpj_entidade cnpj, ltrim(doc_numero, '0') num from fin_parcelas_pagar where ausente_no_alvo_em is null group by 1, 2),
r as (select a.*, exists (select 1 from alvo_qq q where q.cnpj = a.cnpj and q.num = a.num) lancada from adn a where not cancelada)
select case when data_emissao < date '2026-07-18' then '1 antes de 18/07'
            when data_emissao < date '2026-10-01' then '2 18/07–30/09 (janela da 0.6)'
            when data_emissao < date '2026-10-04' then '3 01–03/10'
            else '4 04/10 em diante' end faixa,
       count(*) filter (where not lancada) nao_lancadas, round(sum(valor_servico) filter (where not lancada), 2) valor
from r where data_emissao >= '2026-07-01' group by 1 order by 1;

-- 7. Como a NFS-e é lançada hoje no Alvo (E0000091 de 2026 em desp_realizado_doc — espelho congelado em 06/10)
--    19/10 (797 NFS-e): usuário FISCAL 760; natureza 1.933 = 692 / 2.933 = 105; ConfigTributPIS 98 = 659 / 55 = 138;
--    pedido no item E no cabeçalho 682 / sem pedido 115; 1 item 783; parcela = valor BRUTO em todas as 695 com retenção;
--    anexos 1 = 763, 2 = 31, 0 = 3.
with d as (
  select d.payload_alvo p, d.payload_alvo->'ItemMovEstqChildList'->0 i
  from desp_realizado_doc d
  where d.codigo_tipo_lanc = 'E0000091' and d.especie = 'NFS-e' and d.codigo_empresa_filial = '1.01' and d.data_movimento >= '2026-01-01'),
x as (
  select p->>'CodigoUsuario' usuario, i->>'CodigoNatOperacao' nat, i->>'CodigoConfigTributPIS' cfg_pis,
         coalesce(i->>'NumeroPedComp', '') <> '' item_ped,
         jsonb_array_length(coalesce(p->'MovEstqPedCompChildList', '[]')) > 0 cab_ped,
         jsonb_array_length(coalesce(p->'ItemMovEstqChildList', '[]')) n_itens,
         (p->>'ValorDocumento')::numeric vdoc,
         (select sum((pp->>'ValorParcela')::numeric) from jsonb_array_elements(coalesce(p->'ParcPagMovEstqChildList', '[]')) pp) vparc,
         coalesce((p->>'ValorPISRFServico')::numeric, 0) + coalesce((p->>'ValorCOFINSRFServico')::numeric, 0)
           + coalesce((p->>'ValorCSLLRFServico')::numeric, 0) + coalesce((p->>'ValorIRRFServico')::numeric, 0)
           + coalesce((p->>'ValorINSSServico')::numeric, 0) + coalesce((p->>'ValorISSServico')::numeric, 0) ret,
         jsonb_array_length(coalesce(p->'MovEstqArquivoChildList', '[]')) anexos
  from d)
select 'usuario' dim, usuario val, count(*) n from x group by 2
union all select 'natureza', nat, count(*) from x group by 2
union all select 'config_pis', cfg_pis, count(*) from x group by 2
union all select 'pedido', case when item_ped and cab_ped then 'item+cabecalho' when item_ped then 'so item'
                                when cab_ped then 'so cabecalho' else 'sem' end, count(*) from x group by 2
union all select 'itens', n_itens::text, count(*) from x group by 2
union all select 'parcela', case when ret = 0 then 'sem retencao' when abs(vparc - vdoc) <= 0.05 then 'bruto'
                                 when abs(vparc - (vdoc - ret)) <= 0.05 then 'liquido' else 'outro' end, count(*) from x group by 2
union all select 'anexos', anexos::text, count(*) from x group by 2
order by 1, 3 desc;

-- 8. Natureza × UF do prestador (19/10: 1.933/SP 692 · 2.933/fora de SP 104 · 2.933/SP 1)
select d.payload_alvo->'ItemMovEstqChildList'->0->>'CodigoNatOperacao' natureza,
       case when coalesce(d.payload_alvo->>'SiglaUnidFederacaoEntidade', e.uf) = 'SP' then 'SP' else 'fora de SP' end uf, count(*)
from desp_realizado_doc d left join compras_entidades_cache e on e.codigo_entidade = d.codigo_entidade
where d.codigo_tipo_lanc = 'E0000091' and d.especie = 'NFS-e' and d.codigo_empresa_filial = '1.01' and d.data_movimento >= '2026-01-01'
group by 1, 2 order by 3 desc;

-- 9. ConfigTributPIS por mês (19/10: 98 dominante até ago; set = 24 × 43 para o 55; out = 0 × 2) → regra mudou em set/2026
select to_char(d.data_movimento, 'YYYY-MM') mes,
       count(*) filter (where d.payload_alvo->'ItemMovEstqChildList'->0->>'CodigoConfigTributPIS' = '98') cfg98,
       count(*) filter (where d.payload_alvo->'ItemMovEstqChildList'->0->>'CodigoConfigTributPIS' = '55') cfg55
from desp_realizado_doc d
where d.codigo_tipo_lanc = 'E0000091' and d.especie = 'NFS-e' and d.codigo_empresa_filial = '1.01' and d.data_movimento >= '2026-01-01'
group by 1 order by 1;
