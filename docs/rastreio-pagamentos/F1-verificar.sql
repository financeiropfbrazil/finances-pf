-- =====================================================================
-- LR-PAG · Fase 1 — VERIFICAÇÃO pós-aplicação (somente leitura)
-- Rodar depois do F1-aplicar.sql e de novo depois do próximo refresh
-- de hora cheia (:55), para provar que o cron segue recalculando a MV nova.
-- =====================================================================

-- 1. Objetos no lugar
select to_regclass('public.mv_rastreio_compras')            as mv_nova,
       to_regclass('public.mv_rastreio_compras_v1')         as mv_guardada_para_rollback,
       to_regprocedure('public.rastreio_pagamento_nf(bigint)') as rpc_card,
       to_regprocedure('public.rastreio_classe_pagamento(text,text,text)') as regra,
       (select max(atualizado_em) from public.mv_rastreio_compras) as mv_atualizada_em;

-- 2. Acessos: tudo tem de vir false
select has_table_privilege('anon', 'public.mv_rastreio_compras', 'select')                      as anon_le_mv,
       has_table_privilege('authenticated', 'public.mv_rastreio_compras', 'select')             as auth_le_mv,
       has_function_privilege('anon', 'public.rastreio_pagamento_nf(bigint)', 'execute')        as anon_rpc,
       has_function_privilege('anon', 'public.rastreio_classe_pagamento(text,text,text)', 'execute') as anon_regra;

-- 3. Etapas (esperado em 15/10: "Pago (1ª parcela)" ~2.122; nenhum "Pago antes da NF" sem adiantamento)
select etapa, count(*) linhas from public.mv_rastreio_compras group by 1 order by 1;

select count(*) as pago_antes_da_nf_sem_adiantamento
from public.mv_rastreio_compras
where etapa = 'Pago antes da NF' and primeiro_pagamento_origem is distinct from 'Adiantamento';

-- 4. Coerência dos totais por NF (pago + quitado + em aberto + não confirmado ≈ total)
with nf as (
  select distinct chave_movestq, tit_total, tit_total_pago, tit_total_quitado_adto, tit_total_em_aberto, tit_qtd_nao_confirmadas
  from public.mv_rastreio_compras where chave_movestq is not null and tit_total is not null
)
select count(*) as nfs_com_titulo,
       count(*) filter (where tit_qtd_nao_confirmadas > 0) as nfs_com_parcela_nao_confirmada,
       count(*) filter (where tit_total_em_aberto > 0) as nfs_com_saldo_em_aberto,
       round(sum(tit_total_pago)) as soma_pago_confirmado
from nf;

-- 5. Amostra para conferir no Alvo (NF de vários pedidos)
select pedido_numero, nf_numero, nf_qtd_pedidos, valor_pedido_na_nf, nf_valor_total,
       tit_total, tit_total_pago, tit_total_em_aberto, tit_qtd_pagas, tit_qtd_parcelas, tit_lido_em
from public.mv_rastreio_compras
where nf_qtd_pedidos > 1
order by nf_entrada desc nulls last
limit 10;
