-- LR-PAG F3 — conferência (só leitura)
select jobid, jobname, schedule, active, command from cron.job where jobname = 'sync-parcelas-pagar-leve-horario';
-- Execuções do dia (esperado: "[lista] · meses ok 3/3" a cada hora, ~45 s, 0 erro)
select started_at at time zone 'America/Sao_Paulo' as inicio, duracao_ms, total_erros, observacao
from public.sync_runs
where job_type = 'parcelas_pagar' and observacao like '[lista]%' and started_at > now() - interval '1 day'
order by started_at desc;
-- Quão atrás o espelho está do Alvo: o último título novo visto
select max(primeiro_visto_em) at time zone 'America/Sao_Paulo' as ultimo_titulo_novo from public.fin_parcelas_pagar;
