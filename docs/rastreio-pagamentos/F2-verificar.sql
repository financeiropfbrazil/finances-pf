-- =====================================================================
-- LR-PAG · Fase 2 — VERIFICAÇÃO (somente leitura)
-- Rodar depois do F2-aplicar.sql e do deploy da Edge v9.
-- =====================================================================

-- 1. Objetos e job
select to_regclass('public.rastreio_tentativa') as tabela,
       (select count(*) from public.rastreio_tentativa) as linhas,
       has_table_privilege('anon', 'public.rastreio_tentativa', 'select') as anon_le,          -- false
       has_table_privilege('authenticated', 'public.rastreio_tentativa', 'select') as auth_le, -- false
       (select jobid || ' ' || jobname || ' ' || schedule || ' ' || active
          from cron.job where jobname = 'sync-parcelas-pagar-nf-fila') as job_novo,
       exists (select 1 from cron.job where jobid = 31) as job_31_ainda_existe;               -- false

-- 2. Edge v9 rodando: toda execução nova traz "edge v9-2026-10-15" na observação
select started_at at time zone 'America/Sao_Paulo' as inicio_brt, triggered_by, duracao_ms,
       total_consultados, total_erros, observacao
from public.sync_runs
where job_type = 'parcelas_pagar'
order by started_at desc
limit 5;

-- 3. Itens em espera ou estacionados (o que o cron está deixando de tentar)
select etapa, chave, tentativas, proxima_em at time zone 'America/Sao_Paulo' as proxima_brt,
       ultimo_erro, primeiro_erro_em at time zone 'America/Sao_Paulo' as primeiro_erro_brt
from public.rastreio_tentativa
order by tentativas desc, atualizado_em desc;

-- Para liberar um item estacionado (escrita — só com ordem do Pedro):
--   delete from public.rastreio_tentativa where etapa = '<P|B1|B2>' and chave = '<chave>';
