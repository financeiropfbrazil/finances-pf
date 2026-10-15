-- =====================================================================
-- PROJ-L12 — ROLLBACK (colar no SQL Editor; tem DROP, não vai pelo MCP)
-- A função é só de leitura: removê-la não apaga dado nenhum. A tela do
-- Projetos volta a mostrar "pagamentos indisponíveis" no detalhe do pedido.
-- =====================================================================
drop function if exists public.projeto_pedidos_pagamentos(uuid);
notify pgrst, 'reload schema';
