-- =====================================================================
-- VND-5 — conferências da carga histórica de NF de saída (somente leitura)
-- PLANO-VENDAS.md §15. Rodar depois da lista e do detalhe.
-- =====================================================================

-- 1. Situação da carga
select modelo, serie, count(*) notas, min(numero) menor, max(numero) maior,
       min(data_emissao) de, max(data_emissao) ate,
       count(*) filter (where detalhe_status = 'carregado')   carregadas,
       count(*) filter (where detalhe_status = 'pendente')    pendentes,
       count(*) filter (where detalhe_status = 'erro')        com_erro,
       count(*) filter (where detalhe_status = 'estacionado') estacionadas,
       count(*) filter (where situacao_hub = 'ausente')       ausentes,
       count(*) filter (where situacao_hub = 'provisoria')    nfse_provisorias
  from public.nf_saida group by 1, 2 order by 1, 2;

-- 2. Lacunas de numeração (cada uma a confirmar com modo "notas")
select modelo, serie, count(*) lacunas, min(numero), max(numero),
       (array_agg(numero order by numero))[1:30] primeiras
  from public.v_nf_saida_lacunas group by 1, 2;

-- 3. Notas por mês × tipo de operação (só emitidas de saída)
select date_trunc('month', data_emissao)::date mes, tipo_nota, tipo_operacao,
       count(*) notas,
       count(*) filter (where cancelada) canceladas,
       round(sum(valor_total) filter (where not coalesce(cancelada, false)), 2) valor_nao_cancelado
  from public.v_nf_saida
 group by 1, 2, 3 order by 1, 2, 3;

-- 4. Áustria × intercompany: toda NF-e/NFS-e da PEF no intercompany existe no espelho com o mesmo valor?
--    (Exceção conhecida: NFS-e 425 e 438 — número reaproveitado, achado 2.5)
with ic as (
  select distinct on (especie, numero_documento)
         especie, numero_documento, data_emissao, valor_brl_alvo
    from public.intercompany_invoices
   where especie in ('NF-e', 'NFS-e')
   order by especie, numero_documento, updated_at desc)
select ic.especie, ic.numero_documento, ic.data_emissao data_ic, n.data_emissao data_espelho,
       ic.valor_brl_alvo valor_ic, n.valor_total valor_espelho,
       case when n.id is null then 'FALTA NO ESPELHO'
            when n.valor_total is distinct from ic.valor_brl_alvo then 'VALOR DIFERENTE'
            when n.data_emissao is distinct from ic.data_emissao then 'DATA DIFERENTE'
            else 'ok' end situacao
  from ic
  left join public.nf_saida n
    on n.codigo_empresa_filial = '1.01' and n.modelo = ic.especie and n.numero_alvo = ic.numero_documento
 order by situacao desc, ic.especie, ic.numero_documento;

-- 5. Países sem região cadastrada
select * from public.v_nf_saida_paises_sem_regiao;

-- 6. Execuções da carga
select started_at, triggered_by, duracao_ms, total_candidatos, total_consultados, total_erros, observacao
  from public.sync_runs where job_type = 'nf_saida' order by started_at;

-- 7. Receita bruta (Balancete 4.1.01) × espelho — "regra D" (05/11/2026), que zerou 7 de 19 meses:
--    classe 01 (venda) MENOS simples faturamento de entrega futura (5.922/6.922)
--    MAIS remessas de entrega futura sem classe no Alvo (5.116/6.116);
--    NFS-e no mês da menor data entre emissão e competência; NF-e pela emissão.
--    Os valores do Balancete vêm do conector Balancete P&F (dre, linha 4.1.01); atualizar a lista ao rodar.
with contab(mes, r) as (values
 ('2025-01',2464691.28),('2025-02',2237139.98),('2025-03',2310429.71),('2025-04',2993689.06),('2025-05',3595878.53),
 ('2025-06',2111140.92),('2025-07',3247495.86),('2025-08',1912172.56),('2025-09',2240096.93),('2025-10',4712201.17),
 ('2026-01',3339377.53),('2026-02',2511877.73),('2026-03',3267023.79),('2026-04',2008723.29),('2026-05',2772464.51),
 ('2026-06',2901302.55),('2026-07',3237110.07),('2026-08',1904001.87),('2026-09',2739580.98)),
v as (
  select to_char(case when modelo = 'NFS-e' then least(data_emissao, coalesce(data_competencia, data_emissao))
                      else data_emissao end, 'YYYY-MM') mes,
         left(natureza_principal, 5) cfop, tipo_operacao, valor_total
    from public.v_nf_saida
   where tipo_nota = 'Saída' and not coalesce(cancelada, false)),
d as (
  select mes, sum(valor_total) filter (
           where (tipo_operacao = 'venda' and cfop not in ('5.922', '6.922'))
              or (tipo_operacao is null and cfop in ('5.116', '6.116'))) x
    from v group by 1)
select c.mes, c.r contabil, round(d.x, 2) espelho, round(d.x - c.r, 2) diferenca
  from contab c left join d on d.mes = c.mes order by 1;
