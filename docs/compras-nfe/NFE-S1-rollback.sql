-- NFE-S1 — rollback: remove a RPC criada em NFE-S1-aplicar.sql (objeto novo; nada mais depende dela no banco).
-- Antes de rodar, reverter no código o commit que passou a chamá-la (a tela de Notas Fiscais mostraria erro).
drop function if exists public.compras_nfe_no_alvo(date, date);
