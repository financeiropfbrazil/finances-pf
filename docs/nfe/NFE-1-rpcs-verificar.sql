-- NFE-1 — conferência (só leitura; os testes de escrita rodam dentro de begin … rollback)

-- 1. As 3 RPCs existem, sem anon
select p.oid::regprocedure, p.proacl::text, p.prosecdef from pg_proc p
where p.proname in ('compras_nfe_importar_xml', 'compras_nfe_vincular_pedidos', 'compras_nfe_desvincular');
-- esperado: 3 linhas · {postgres=X,authenticated=X,service_role=X} · true

-- 2. Como Hugo (Analista Fiscal): importar (nova / duplicada / inválida) — tudo desfeito no rollback
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.compras_nfe_importar_xml(jsonb_build_object('chave_acesso', repeat('0', 44), 'numero', '999999', 'data_emissao', '2026-10-30T10:00:00-03:00', 'valor_total', '1.23'), '<nfeProc>' || repeat('0', 44) || '</nfeProc>')->>'status' nova,
       public.compras_nfe_importar_xml(jsonb_build_object('chave_acesso', repeat('0', 44)), '<x>' || repeat('0', 44) || '</x>')->>'status' dup,
       public.compras_nfe_importar_xml(jsonb_build_object('chave_acesso', '123'), 'x')->>'status' invalida;
rollback;

-- 3. Como Mirlene (sem compras.nfe.create): 42501 nas 3
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
create or replace function pg_temp.t(f text) returns text language plpgsql as $$
begin
  if f = 'imp' then perform public.compras_nfe_importar_xml('{}'::jsonb, 'x');
  elsif f = 'vin' then perform public.compras_nfe_vincular_pedidos(gen_random_uuid(), '[]'::jsonb);
  else perform public.compras_nfe_desvincular(gen_random_uuid()); end if;
  return 'passou';
exception when others then return sqlstate;
end $$;
select pg_temp.t('imp'), pg_temp.t('vin'), pg_temp.t('des');
rollback;

-- ── Resultado (30/10/2026) ──
-- 1. 3 RPCs, ACL sem anon, security definer — ok.
-- 2. Hugo: importada / duplicada / erro ("Chave de acesso inválida"); vincular a 2 pedidos → vinculada, principal 0005205,
--    2 linhas em compras_nfe_pedidos; desvincular → success. Depois do rollback: chave de teste 0, vinculadas 2, vínculos 5,
--    968 notas (= antes).
-- 3. Mirlene: 42501 nas 3 — ok.
