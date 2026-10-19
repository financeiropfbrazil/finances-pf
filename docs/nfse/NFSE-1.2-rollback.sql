-- NFSE-1.2 — rollback (objeto novo). Rodar DEPOIS do rollback da NFSE-1.3 (as RPCs leem a view).
drop view if exists public.v_nfse_recebida;
