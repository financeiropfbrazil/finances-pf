-- =====================================================================
-- LR-PAG F3 — Leitura leve do contas a pagar de hora em hora (Pedro, 19/11/2026: "ok")
-- Projeto: hbtggrbauguukewiknew.
-- Problema: o espelho fin_parcelas_pagar só é lido 2×/dia útil (job 30: 06h40 e 12h40 BRT). Lançamento feito no Alvo
--   depois das 12h40 só aparece no Hub no dia seguinte; e se a leitura da manhã cai (watchdog, Alvo lento — 18/11),
--   o atraso chega a 24 h. Ex.: NFS-e 266199562 Microsoft (MovEstq 22326, lançada 17/11 à tarde) "não lançada" até a
--   leitura manual de 18/11 12h09.
-- Solução: job novo que roda a MESMA leitura (modo lista) só com os vencimentos do mês atual e dos 2 seguintes
--   (~1.960 parcelas, ~45 s), de hora em hora das 8h às 18h BRT nos dias úteis, às :35 (minuto livre; o refresh do
--   Rastreio das :55 já pega o que foi lido), pulando as 12h (a completa roda às 12h40). O job 30 segue igual.
--   Nada muda na Edge. Ausentes: a Edge só marca título excluído em mês lido inteiro (já é assim).
-- Rollback: F3-leitura-horaria-rollback.sql (cron.unschedule).
-- =====================================================================
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-parcelas-pagar-leve-horario') then
    raise exception 'job sync-parcelas-pagar-leve-horario já existe';
  end if;
end $$;

-- UTC: 11–14 e 16–21 = 8h–11h e 13h–18h BRT
select cron.schedule(
  'sync-parcelas-pagar-leve-horario',
  '35 11-14,16-21 * * 1-5',
  $cron$ select public.call_sync_parcelas_pagar_modo('lista',
           to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM'),
           to_char((now() at time zone 'America/Sao_Paulo') + interval '2 months', 'YYYY-MM'),
           'pg_cron'); $cron$);
