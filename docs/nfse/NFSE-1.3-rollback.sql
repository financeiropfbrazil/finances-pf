-- NFSE-1.3 — rollback (objetos novos). Antes, reverter no código o commit da tela /compras/notas-servico.
drop function if exists public.nfse_recebidas_listar(date, date, text, text[], text[], text, integer, integer);
drop function if exists public.nfse_recebida_xml(text);
