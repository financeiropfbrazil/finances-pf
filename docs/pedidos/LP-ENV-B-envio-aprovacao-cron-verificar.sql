-- LP-ENV B — conferência (só leitura)
select jobid, jobname, schedule, active from cron.job where jobname = 'pedidos-envio-aprovacao';            -- 45 · '10 10-23 * * 1-5'
select has_function_privilege('anon', 'public.call_pedidos_envio_aprovacao_cron(text)', 'execute') as anon; -- false
-- Execuções (24/11 15h18, manual: 39 candidatos, 37 lidos, 1 enviado — 0005364 —, 2 × HTTP 502 do gateway)
select started_at at time zone 'America/Sao_Paulo' as inicio, triggered_by, duracao_ms, total_candidatos, total_consultados,
       total_mudaram, total_erros, observacao
from public.sync_runs where job_type = 'envio_aprovacao' order by started_at desc limit 20;
-- Pedidos ainda na fila (em aberto, últimos 90 dias, sem data de envio)
select count(*) from public.compras_pedidos
where codigo_empresa_filial = '1.01' and enviado_aprovacao_em is null and enviado_aprovacao_origem is null
  and status in ('Aberto', 'Pendente', 'Reavaliar') and data_pedido >= current_date - 90 and numero not like 'RASCUNHO%';
