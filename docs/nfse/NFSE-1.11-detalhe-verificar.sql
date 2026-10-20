-- NFSE-1.11 — conferência (transação desfeita; claims simulados)
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-OPERADOR>', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nfse_recebida_detalhe('<CHAVE-50>');
rollback;

-- ── Resultado (20/10/2026, MCP "nfse_1_11_detalhe" + "nfse_1_11_detalhe_saldo_forca4") ──
-- Operador de Compras sem admin, 3 notas:
--   lançada com pedido (ELUS nº 54083): vinculado 0004727 (Encerrado, Serviço), MovEstq 21211 E0000091, 1 parcela em aberto
--   lançada sem pedido (Viracopos nº 3862537): vinculados [] e candidatos [] (taxa de aeroporto), MovEstq 21217
--   não lançada (WT Agência nº 1703, R$ 48.596,14): 4 candidatos por saldo ±20% (dif −4,2% a +7,1%); o 5º (saldo 0)
--     saiu com o ajuste da força 4 (exige saldo > 5% da nota)
--   descrição, competência, código do serviço e ISS retido extraídos do XML; 0,21 s
-- Usuário sem compras.nfse.access → 42501 · anon → permission denied · ACL {postgres, authenticated, service_role}
