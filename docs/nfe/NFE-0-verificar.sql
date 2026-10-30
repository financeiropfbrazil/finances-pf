-- NFE-0 — conferência (só leitura)

-- 1. Corpo novo, ACL intacto (sem anon), funções novas sem anon
select md5(prosrc) md5, proacl::text acl from pg_proc where oid = 'public.compras_nfe_no_alvo(date,date)'::regprocedure;
-- esperado: md5 1955aba63fa615802b967c6927f436a8 · {postgres=X,authenticated=X,service_role=X}
select p.oid::regprocedure, p.proacl::text from pg_proc p where p.proname in ('nfe_pode_acessar', 'nfe_pode_gravar');

-- 2. Como Hugo (Analista Fiscal, sem admin): a coluna "No Alvo" responde
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) achadas_set, public.nfe_pode_acessar() pode_ver, public.nfe_pode_gravar() pode_gravar
from public.compras_nfe_no_alvo('2026-09-01', '2026-09-30');
rollback;

-- 3. Como Mirlene (só Operador de Compras): 42501
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
create or replace function pg_temp.t() returns text language plpgsql as $$
begin
  perform * from public.compras_nfe_no_alvo('2026-09-01', '2026-09-30');
  return 'passou';
exception when others then return sqlstate || ' ' || sqlerrm;
end $$;
select pg_temp.t();
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado pelo MCP (migration nfe_0_gate_no_alvo), pré-voo ok (fingerprint 2.389, md5 anterior d708176b…).
-- 1. md5 1955aba63fa615802b967c6927f436a8; ACL sem anon — ok.
-- 2. Hugo: 172 notas de setembro achadas no Alvo (= admin); pode ver e pode gravar.
-- 3. Mirlene: 42501 "Sem permissão para Notas Fiscais" — ok.
