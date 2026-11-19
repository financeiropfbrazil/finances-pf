-- L5-C — rollback: devolve classe_rec_desp, classe_rateio e updated_at ao estado de antes (vazios), só nos pedidos
-- que ainda estão exatamente como a L5-C deixou (se o cron ou alguém mudou depois, não mexe). Só com ordem do Pedro.
begin;
update public.compras_pedidos cp
   set classe_rec_desp = b.classe_rec_desp_antes,
       classe_rateio   = b.classe_rateio_antes,
       updated_at      = b.updated_at_antes
  from public.zz_bkp_pedidos_classe_20261030 b
 where cp.id = b.id
   and cp.classe_rec_desp is not distinct from b.classe_rec_desp_nova
   and cp.classe_rateio = b.classe_rateio_nova;
-- conferir o número de linhas (esperado 417) antes do commit
commit;

-- Depois de validado (sem rollback), a limpeza é: drop table public.zz_bkp_pedidos_classe_20261030;  — só com ordem do Pedro.
