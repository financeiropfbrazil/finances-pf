-- CARTAO-1 — conferência
-- 1. Coluna nova, nula, sem backfill (583 linhas e nenhuma com base em 20/10/2026)
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cartao_import_item' and column_name = 'data_base_vencimento';
select count(*) as linhas, count(data_base_vencimento) as com_base from public.cartao_import_item;

-- 2. RPC: SECURITY DEFINER, sem EXECUTE para anon, com EXECUTE para authenticated
select p.oid::regprocedure, p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'fn_cartao_definir_base_vencimento';

-- 3. Gate sem login (SQL editor/MCP roda sem auth): deve falhar com "Sem permissao cartao.edit", sem gravar nada
-- select * from public.fn_cartao_definir_base_vencimento(
--   array[(select id from public.cartao_import_item limit 1)], date '2026-11-10');

-- 4. Teste na tela com usuário SEM is_admin (o Pedro tem bypass): importar fatura de teste → coluna "Base venc."
--    pré-preenchida com o vencimento → editar 1 linha → editar em massa → conferir:
-- select l.numero_onfly, l.data_vencimento as venc_fatura, i.data_transacao, i.valor, i.data_base_vencimento, i.status_linha
--   from public.cartao_import_item i join public.cartao_import_lote l on l.id = i.lote_id
--  where l.created_at > now() - interval '1 day' order by l.created_at desc, i.data_transacao;

-- ── Resultado (20/10/2026 ~09h15 BRT, MCP apply_migration "cartao_1_base_vencimento_por_linha", OK do Pedro) ──
-- pré-voo: compras_pedidos 2.312 · cartao_import_item 583 (todas emitidas) · coluna e função inexistentes
-- 1. data_base_vencimento date nullable · 583 linhas / 0 com base / 0 com updated_at alterado (sem backfill)
-- 2. fn_cartao_definir_base_vencimento(uuid[],date) SECURITY DEFINER, ACL {postgres, authenticated, service_role},
--    anon = false
-- 3. sem login → "Sem permissao cartao.edit"
-- 3b. sessão simulada da operadora (is_admin = false, com cartao.edit; role authenticated; transação desfeita)
--    sobre linha emitida → "1 linha(s) ja emitida(s) no Alvo…" — passou o gate e recusou; nada gravado
-- 4. PENDENTE: teste na tela após merge + Publish (import → base pré-preenchida → edição por linha e em massa)
