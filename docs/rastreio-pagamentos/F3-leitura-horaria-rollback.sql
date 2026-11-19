-- LR-PAG F3 — rollback: desliga a leitura leve de hora em hora (o job 30, 06h40 e 12h40, segue como sempre).
select cron.unschedule('sync-parcelas-pagar-leve-horario');
