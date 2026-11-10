-- NFE-S2 — conferência (só leitura)
select enabled, paused_reason from public.sync_settings where job_name = 'sync-nfe';                 -- false · NFE-S2…
select proacl::text,
       has_function_privilege('anon', 'public.call_sync_nfe_cron(text)', 'execute') anon,
       has_function_privilege('authenticated', 'public.call_sync_nfe_cron(text)', 'execute') autenticado
from pg_proc where oid = 'public.call_sync_nfe_cron(text)'::regprocedure;
-- esperado: {postgres=X,service_role=X} · false · false
select policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' and tablename = 'email_notas_fiscais';
-- esperado: só email_notas_fiscais_admin_ler · SELECT · {authenticated} · (SELECT _is_admin())

-- Como Hugo (sem admin): não lê nem grava email_notas_fiscais
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from public.email_notas_fiscais;                                    -- 0
update public.email_notas_fiscais set status = status where true;                    -- UPDATE 0
rollback;

-- Como admin (Pedro): lê as 23
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'pedro.scrignoli@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from public.email_notas_fiscais;                                    -- 23
rollback;
