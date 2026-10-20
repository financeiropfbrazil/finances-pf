-- =====================================================================
-- NFSE-1.9 + NFSE-1.13 — ligar o cron do ADN e 2ª leitura diária do contas a pagar — 20/10/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (20/10/2026): "ligue os jobs de acordo com suas sugestões".
--   NFSE-1.9 : job 35 nfse-adn-sonda → active = true (de 30 em 30 min, 07h00–18h30 BRT, dias úteis).
--   NFSE-1.13: job 30 sync-parcelas-pagar-diario → 06h40 e 12h40 BRT (era só 06h40). Motivo medido em
--              20/10: lançamento no Alvo → MovEstq/DocFin no Hub p50 19 h / p90 70 h, todo ele a espera
--              da leitura única das 06h40 (a fila do job 34 está vazia). Leitura diária = ~3.800 títulos
--              em 52–80 s, 0 erro. A Edge é idempotente (upsert; "ausente" só depois de um mês lido inteiro).
-- Só muda agendamento/estado de jobs que já existem + o texto descritivo do kill-switch do job 30.
-- Rollback: NFSE-1.9-cron-rollback.sql (ou, para parar o ADN na hora sem mexer no cron:
--   update public.sync_settings set enabled = false where job_name = 'nfse-adn-sonda';).
-- =====================================================================
begin;

-- ── Pré-voo: qualquer divergência aborta e nada muda ─────────────────
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: compras_pedidos < 2000 — não parece o Financial Hub';
  end if;
  if not exists (select 1 from cron.job where jobid = 35 and jobname = 'nfse-adn-sonda'
                 and schedule = '0,30 10-21 * * 1-5' and active = false) then
    raise exception 'Job 35 fora do estado esperado (nfse-adn-sonda, 0,30 10-21 * * 1-5, desligado)';
  end if;
  if not exists (select 1 from cron.job where jobid = 30 and jobname = 'sync-parcelas-pagar-diario'
                 and schedule = '40 9 * * 1-5' and active) then
    raise exception 'Job 30 fora do estado esperado (sync-parcelas-pagar-diario, 40 9 * * 1-5, ligado)';
  end if;
  if not exists (select 1 from public.sync_settings where job_name = 'nfse-adn-sonda' and enabled) then
    raise exception 'Kill-switch nfse-adn-sonda desligado — ligar o job não teria efeito';
  end if;
  if exists (select 1 from public.sync_runs where job_type = 'nfse_adn' and finished_at is null) then
    raise exception 'Há execução nfse_adn aberta';
  end if;
end $$;

-- ── NFSE-1.9 ─────────────────────────────────────────────────────────
select cron.alter_job(job_id := 35, active := true);

-- ── NFSE-1.13 (pg_cron em UTC: 9 = 06h40 BRT, 15 = 12h40 BRT) ─────────
select cron.alter_job(job_id := 30, schedule := '40 9,15 * * 1-5');

update public.sync_settings
   set schedule_cron = '40 9,15 * * 1-5 (lista, 06h40 e 12h40 BRT) + */3 * * * * (nf, só com fila e sem outra execução rodando)',
       updated_at = now()
 where id = '9a3d51a5-9b3a-4c5a-9820-84a8fdc5e2d0'
   and job_name = 'sync-parcelas-pagar';

-- ── Conferência dentro da transação ──────────────────────────────────
do $$
begin
  if not exists (select 1 from cron.job where jobid = 35 and active and schedule = '0,30 10-21 * * 1-5') then
    raise exception 'Conferência: job 35 não ficou ligado';
  end if;
  if not exists (select 1 from cron.job where jobid = 30 and active and schedule = '40 9,15 * * 1-5') then
    raise exception 'Conferência: job 30 não ficou com 06h40 e 12h40';
  end if;
end $$;

commit;
