-- NFE-21 · conferência do interruptor (só leitura). Esperado: 1 linha, enabled = true.
select job_name, enabled, schedule_cron, paused_reason, updated_at
from public.sync_settings
where job_name in ('exportar-notas-recebidas-balancete', 'exportar-notas-balancete')
order by job_name;
