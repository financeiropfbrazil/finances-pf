-- NFE-21 · interruptor da janela de leitura das notas recebidas para o Balancete
-- Só cria a linha do interruptor em sync_settings (aparece na tela de configuração dos jobs, ao lado de
-- exportar-notas-balancete). Sem a linha a janela também funciona (a função trata "sem linha" como ligada);
-- a linha existe para o Pedro poder DESLIGAR sem deploy: enabled = false → a função responde 503.
-- Pré-voo: fingerprint (compras_pedidos >= 2000) e a linha ainda não existe.
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'fingerprint falhou: este não é o banco do Financial Hub';
  end if;
end $$;

insert into public.sync_settings (job_name, enabled, schedule_cron)
select 'exportar-notas-recebidas-balancete', true, 'sob demanda: o Balancete P&F busca a cada 30 minutos'
where not exists (select 1 from public.sync_settings where job_name = 'exportar-notas-recebidas-balancete');
