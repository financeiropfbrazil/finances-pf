-- =====================================================================
-- LR-PAG · Fase 1 — LIMPEZA (só depois da Fase 1 validada em produção)
-- Apaga a cópia guardada para rollback. Depois disto, o rollback passa a
-- exigir recriar a definição antiga à mão (ela fica no histórico do diário).
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.mv_rastreio_compras') is null
     or to_regprocedure('public.rastreio_pagamento_nf(bigint)') is null then
    raise exception 'LIMPEZA: a Fase 1 não está aplicada. Nada foi apagado.';
  end if;
  if exists (select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid
             where d.refobjid = 'public.mv_rastreio_compras_v1'::regclass
               and r.ev_class <> 'public.mv_rastreio_compras_v1'::regclass) then
    raise exception 'LIMPEZA: ainda há view lendo a v1. Nada foi apagado.';
  end if;
end $$;
drop materialized view public.mv_rastreio_compras_v1;
commit;
