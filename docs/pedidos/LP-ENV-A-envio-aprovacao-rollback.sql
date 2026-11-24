-- LP-ENV A — rollback. Tira o gatilho e as colunas (a data do envio se perde; o backfill pode ser refeito pelo aplicar).
-- Antes: desligar a Edge LP-ENV B (select cron.unschedule('pedidos-envio-aprovacao')) e voltar o frontend, que lê as colunas.
drop trigger if exists trg_compras_pedidos_envio_aprovacao on public.compras_pedidos;
drop function if exists public.compras_pedidos_carimbar_envio_aprovacao();
alter table public.compras_pedidos
  drop column if exists enviado_aprovacao_em,
  drop column if exists enviado_aprovacao_origem;
-- sync_runs: o valor 'envio_aprovacao' pode ficar no check (inofensivo). Para tirar, apagar antes as linhas desse job_type.
