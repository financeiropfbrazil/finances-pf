-- NFSE-1.10 — conferência. Os testes de usuário rodam numa transação desfeita (claims simulados + set local role authenticated).
-- 1. Buckets, policies e ACL
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('nfse-nf-pdf', 'nfse-boleto-pdf');
select policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'storage' and policyname like 'nfse_anexos%';
select relacl from pg_class where oid = 'public.nfse_anexo'::regclass;

-- 2. Operador de Compras sem admin grava e registra (rollback no fim)
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-OPERADOR>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, metadata)
values ('nfse-nf-pdf', '<CHAVE-50>/<UUID>.pdf', '<UUID-OPERADOR>', '{"size": 12345, "mimetype": "application/pdf"}');
select public.nfse_anexo_registrar('<CHAVE-50>', 'nf', '<UUID>', 'nota.pdf');
rollback;

-- ── Resultado (20/10/2026, MCP apply_migration "nfse_1_10_anexos") ──
-- buckets privados, 10 MB, só application/pdf; 2 policies (SELECT, INSERT) presas aos 2 buckets; sem UPDATE/DELETE
-- Operador de Compras sem admin: INSERT no storage aceito + registrar → success:true (tamanho 12.345 do metadado)
-- Usuário sem compras.nfse.access: INSERT → "new row violates row-level security policy for table objects"
-- authenticated lendo nfse_anexo direto → permission denied (leitura só pela RPC de detalhe)
-- nfse_storage_pode_gravar: caminho certo true · nome fora do padrão false · chave inexistente false · .exe false
