-- NFE-21 · volta atrás do interruptor: remove só a linha criada pelo -aplicar.sql.
-- Para DESLIGAR a janela sem remover a linha, prefira:
--   update public.sync_settings set enabled = false, paused_at = now(), paused_reason = '<motivo>'
--   where job_name = 'exportar-notas-recebidas-balancete';
delete from public.sync_settings where job_name = 'exportar-notas-recebidas-balancete';
