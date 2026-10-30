-- L5-C — conferência (só leitura)
select (select count(*) from public.zz_bkp_pedidos_classe_20261030) backup,                         -- 417
       (select count(*) from public.compras_pedidos cp join public.zz_bkp_pedidos_classe_20261030 b on b.id = cp.id
         where cp.classe_rec_desp = b.classe_rec_desp_nova and cp.classe_rateio = b.classe_rateio_nova) aplicados,  -- 417
       (select count(*) from public.compras_pedidos where codigo_empresa_filial = '1.01'
         and status in ('Encerrado', 'Cancelado', 'Cancelado Parcial') and coalesce(status_local::text, '') <> 'excluido_alvo'
         and classe_rec_desp is null) terminais_sem_classe,   -- 31 (27 sem resposta do Alvo na auditoria + 4 com rateio e sem a principal)
       has_table_privilege('authenticated', 'public.zz_bkp_pedidos_classe_20261030', 'select') auth_le_backup;  -- false

-- Amostra: a classe gravada = a da resposta do Alvo
select b.numero, b.status, b.resposta_em::date, cp.classe_rec_desp, cp.classe_rateio
from public.zz_bkp_pedidos_classe_20261030 b join public.compras_pedidos cp on cp.id = b.id
where b.numero in ('0004443', '0004668', '0004606', '0004094');
-- esperado: 0004443 19.06 · 0004668 15.01 (+15.02 no rateio) · 0004606 21.14 · 0004094 19.05

-- ── Resultado (30/10/2026) ──
-- Aplicado (migration pedidos_l5c_classe_auditoria): 417 pedidos (403 Encerrados, 12 Cancelados, 2 Cancelados
-- Parciais), respostas do Alvo de 27/05 a 20/08; formato igual ao gravado pelo cron (conferido contra o 0004995).
-- Efeito no Excel da contabilidade (NFSE-1.16), jan–out/2026: notas com natureza 859 → 923; agosto 102 → 112 (88%);
-- lançadas sem classe 241 → 178.
