-- LP-ENV B — rollback. Para a leitura de hora em hora (o gatilho da LP-ENV A segue carimbando pelas leituras da rotina de compras).
select cron.unschedule('pedidos-envio-aprovacao');
drop function if exists public.call_pedidos_envio_aprovacao_cron(text);
-- Edge pedidos-envio-aprovacao-cron: pode ficar publicada (sem o job ninguém a chama) ou ser apagada pelo painel.
-- Pausa sem rollback: insert into sync_settings (job_name, enabled, paused_reason) values ('pedidos-envio-aprovacao', false, '<motivo>');
