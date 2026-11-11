-- NFE-17 — rollback. Só com ordem do Pedro. Nada é gravado em tabela: só derruba as funções novas.
-- Reverter o commit da tela junto (sem as funções, os downloads de Excel das notas falham ao buscar aprovação/sugeridos).
drop function if exists public.nfe_pedidos_sugeridos(uuid[]);
drop function if exists public.nfse_pedidos_sugeridos(text[]);
drop function if exists public._nfse_texto_pedido(text);
drop function if exists public.pedidos_aprovacao(text[]);
