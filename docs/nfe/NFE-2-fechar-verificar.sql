-- NFE-2 — conferência (só leitura; escritas de teste dentro de begin … rollback)

-- 1. Policies e privilégios
select tablename, policyname, cmd, roles::text, qual from pg_policies
where schemaname = 'public' and tablename in ('compras_nfe', 'compras_nfe_pedidos', 'compras_nfe_fila_chaves');
-- esperado: compras_nfe_ler e compras_nfe_pedidos_ler (SELECT, authenticated, nfe_pode_acessar()); fila sem policy
select c.relname, c.relacl::text from pg_class c where c.relname in ('compras_nfe', 'compras_nfe_pedidos', 'compras_nfe_fila_chaves');
select p.oid::regprocedure, p.proacl::text from pg_proc p where p.proname in ('cadastrar_nfe', 'cadastrar_nfe_da_fila', 'enfileirar_chaves_nfe');
-- esperado: só postgres e service_role

-- 2. Hugo (Analista Fiscal): lê tudo; UPDATE direto recusado
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
create or replace function pg_temp.w() returns text language plpgsql as $$
begin
  update public.compras_nfe set natureza_operacao = natureza_operacao where id = (select id from public.compras_nfe limit 1);
  return 'update passou';
exception when others then return sqlstate;
end $$;
select (select count(*) from public.compras_nfe) le, (select count(*) from public.compras_nfe_pedidos) vinculos, pg_temp.w() update_direto;
rollback;

-- 3. Mirlene (sem compras.nfe.access): 0 linhas
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from public.compras_nfe;
rollback;

-- 4. Entrada da Riosoft (Edge receber-nfe grava como service_role): insert continua passando
begin;
set local role service_role;
insert into public.compras_nfe (tipo_documento, chave_acesso, origem, raw_xml, dados_extraidos)
values ('NFe', repeat('9', 44), 'Alvo', '<x/>', '{"itens":[]}');
rollback;

-- 5. Depois da próxima leva da Riosoft (≈ 12h BRT, dias úteis): notas novas entraram
select max(imported_at) at time zone 'America/Sao_Paulo' ultima_entrada, count(*) filter (where imported_at > '2026-10-30 16:00+00') desde_nfe2
from public.compras_nfe where origem = 'Alvo';

-- ── Resultado (30/10/2026) ──
-- Aplicado pelo MCP (migration nfe_2_fechar_tabelas), conferências internas ok.
-- 2. Hugo: 968 notas, 5 vínculos; UPDATE direto → 42501.   3. Mirlene: 0.
-- 4. service_role: insert ok (desfeito).   anon: 42501 na tabela e em enfileirar_chaves_nfe.
-- 5. Pendente: conferir na próxima leva da Riosoft.
