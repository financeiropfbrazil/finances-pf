-- =====================================================================
-- RLS de public.profiles — FASE 1
-- Fecha a escalada para admin e a identidade forjada, com ZERO mudança de código.
-- Preparado em 28/08/2026. Substitui `docs/SQL-RLS-PROFILES-PROPOSTA.sql`.
-- =====================================================================
--
-- ⚠️ POR QUE ESTE ARQUIVO SUBSTITUI O ANTERIOR
-- A proposta original usava `(a,b,c) IS NOT DISTINCT FROM (SELECT x,y,z FROM f())`.
-- **Essa sintaxe NÃO COMPILA no Postgres** — testado em 28/08/2026:
--     ERROR 42601: subquery must return only one column
-- Trocada por uma função booleana com `EXISTS` e comparação coluna a coluna, cuja
-- semântica foi verificada por SELECT antes de ir para cá:
--     igual → true · diferente → false · ZERO LINHAS → **false** · null vs null → true
-- O caso "zero linhas → false" é o que bloqueia um usuário comum de criar um perfil
-- novo, e é a razão de a formulação importar.
--
-- ✅ AS DUAS PERGUNTAS DE BLOQUEIO FORAM MEDIDAS E DERAM ZERO (28/08/2026 17:3x UTC):
--    1 único admin (pedro.scrignoli, `updated_at` de 24/03/2026) · 5 perfis com
--    `alvo_usuario`, os 5 do próprio dono · `compras_lideres_cc.atribuido_por` só com
--    o Pedro · `user_permissions` com 0 linhas.
--    ⇒ **Aplicar como MANUTENÇÃO, não como resposta a incidente.**
--    🔴 Limite declarado: `track_commit_timestamp` está OFF e não há auditoria de
--    `profiles`. O estado de hoje está limpo; "ninguém escalou e reverteu" é
--    infalsificável com os dados que existem.
--
-- =====================================================================
-- O QUE MUDA NA PRÁTICA
-- =====================================================================
-- (1) USUÁRIO COMUM no próprio perfil: continua podendo gravar `full_name`,
--     `avatar_url`, `must_change_password` e `updated_at`. Passa a ser RECUSADO se
--     o valor proposto de `is_admin`, `is_active`, `email`, `funcionario_alvo_codigo`,
--     `alvo_usuario` ou `id` diferir do que já está lá — e recusado em QUALQUER
--     escrita no perfil de outra pessoa, o que hoje é livre.
--
-- (2) ADMIN: nada muda. `profiles_escrita_admin` é `FOR ALL` com `_is_admin()` nos
--     dois lados, então as duas telas de `settings/Users` (toggle e edição) e o
--     DELETE seguem iguais. Policies permissivas são OR-adas: o admin passa pela
--     dele antes de a de autosserviço importar.
--
-- (3) AS 6 TELAS que resolvem nome por `user_id`: **nada muda.** O SELECT continua
--     `USING (true)` para `authenticated`. Fechar leitura não é este card.
--
-- =====================================================================
-- PRECISA DE MUDANÇA DE CÓDIGO?  NÃO — com duas ressalvas nomeadas
-- =====================================================================
-- Os 3 pontos de escrita do frontend continuam funcionando:
--   · `settings/Users.tsx:251` e `:304` → admin, cobertos pela policy de admin.
--   · `ResetPassword.tsx:79` → é FALLBACK (o primário é a RPC
--     `hub_clear_must_change_password()`), grava no PRÓPRIO perfil e manda
--     `is_admin`/`is_active`/`email` com os valores que leu do banco ⇒ iguais ⇒ passa.
--
-- RESSALVA 1 — o fallback quebraria para um usuário **INATIVO** cujo AuthContext não
--   tenha carregado: ele manda `is_active: profile?.is_active ?? true`, e `true`
--   contra `false` no banco seria recusado. **Medido: 0 inativos hoje.** Não é
--   alcançável, mas é frágil e fica registrado.
-- RESSALVA 2 — a policy de INSERT **bloqueia auto-criação de perfil**. Isso já é o
--   comportamento de fato: `amanda.almeida@pfbrazil.com` está em `auth.users` **sem
--   linha em `profiles`** (medido hoje), o que prova que o primeiro login não cria
--   perfil. Quem cria são as Edge Functions com `service_role`, que bypassam RLS.
--
-- 🔴 ONDE TESTAR DEPOIS: **7 pessoas têm `must_change_password = true`** — são elas
--    que vão exercitar o `/reset-password`, o único caminho de escrita de não-admin.
--    O Pedro tem bypass e erro de permissão nunca aparece para ele.
--
-- =====================================================================
-- COMO EXECUTAR — SEIS PASTES
--
-- ORDEM:  PASTE 1 → PASTE 2 → **PASTE 6 (controle)** → PASTE 3 → PASTE 4 →
--         PASTE 5 → **PASTE 6 (aceite)**
--
-- 🔴 O PASTE 6 RODA DUAS VEZES, e é o que separa "a policy funciona" de "o teste
--    não testa nada":
--      · ANTES do PASTE 3  → (i) e (ii) TÊM de afetar **1 linha** cada. É o
--        CONTROLE: prova que o teste tem dentes. Se já der 0 aqui, o teste está
--        medindo outra coisa e o resultado de depois não vale.
--      · DEPOIS do PASTE 3 → (i) e (ii) TÊM de afetar **0 linhas**.
--    Tudo em BEGIN/ROLLBACK, então rodar duas vezes não custa nada.
--
-- 🔴 O DROP DA POLICY PERMISSIVA É O PASTE 3, NÃO O PRIMEIRO PASSO.
--    Correção do Pedro em 28/08/2026, e evita uma indisponibilidade que a primeira
--    versão deste arquivo teria causado: dropar a permissiva ANTES de criar as novas
--    deixa `profiles` com RLS ligado e ZERO policies para `authenticated`. RLS sem
--    policy NEGA TUDO — inclusive o SELECT que o `AuthContext` faz no primeiro
--    render. Entre um paste e o seguinte, isso é o Hub parado para todo mundo.
--    Criando as novas primeiro não há janela: policies permissivas são OR-adas, e
--    durante a sobreposição vale `true OR (as novas)` = `true`.
--    ⇒ **A mudança é INERTE até o PASTE 3.** Ele é a chave, e é atômico.
--       Parar antes dele deixa o banco na postura de hoje.
-- =====================================================================


-- ═══════════════════════════════════════════════════════════════════════
-- ██ PASTE 1 — PRÉ-VOO E ESTADO ATUAL (blocos 0, 1, 2) · SÓ LEITURA
-- Guarde as saídas de 1.2 e 1.3: são o rollback.
-- ═══════════════════════════════════════════════════════════════════════

-- 1.1 — pré-voo
select current_database()                                   as db,
       (select count(*) from public.compras_pedidos)         as fp_pedidos,
       (select count(*) from public.profiles)                as fp_profiles,
       (select count(*) from public.profiles where is_admin) as fp_admins;

-- 1.2 — policies de hoje  ⟵ GUARDE
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
       (select string_agg(r.rolname, ',') from pg_roles r where r.oid = any(pol.polroles)) as roles,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
where pol.polrelid = 'public.profiles'::regclass;

-- 1.3 — grants de hoje  ⟵ GUARDE
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles'
group by grantee
order by grantee;

-- 1.4 — RLS está mesmo ligado, e NÃO é forçado para o owner
select c.relrowsecurity as rls_ligado, c.relforcerowsecurity as rls_forcado
from pg_class c where c.oid = 'public.profiles'::regclass;


-- ═══════════════════════════════════════════════════════════════════════
-- ██ PASTE 2 — OS INERTES (blocos 3, 4, 6, 7, 8, 9)
-- Nada muda de comportamento: a policy permissiva antiga continua no lugar e
-- policies permissivas são OR-adas, então vale `true OR (as novas)` = `true`.
--
-- 🔴 EM TRANSAÇÃO ÚNICA de propósito. O CLAUDE.md registra que lote colado no SQL
--    Editor já falhou em SILÊNCIO neste projeto (14 revokes, zero efeito, sem
--    mensagem). Com begin/commit é tudo-ou-nada, e o SELECT final delata: se não
--    vierem 4 policies e a função, NÃO siga para o PASTE 3.
-- Idempotente: pode rodar de novo sem efeito diferente.
-- ═══════════════════════════════════════════════════════════════════════
begin;

-- 3 — a função que congela as colunas sensíveis.
-- STABLE de propósito: num UPDATE, função STABLE enxerga o snapshot do início do
-- comando (a linha ANTIGA). SECURITY DEFINER para não recursar no RLS, mesmo
-- padrão do _is_admin(). `create or replace` NÃO preserva os dois — redeclarados.
create or replace function public._profile_self_intacto(
  p_user_id                 uuid,
  p_id                      uuid,
  p_is_admin                boolean,
  p_is_active               boolean,
  p_email                   text,
  p_funcionario_alvo_codigo text,
  p_alvo_usuario            text
) returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.user_id                 is not distinct from p_user_id
      and p.id                      is not distinct from p_id
      and p.is_admin                is not distinct from p_is_admin
      and p.is_active               is not distinct from p_is_active
      and p.email                   is not distinct from p_email
      and p.funcionario_alvo_codigo is not distinct from p_funcionario_alvo_codigo
      and p.alvo_usuario            is not distinct from p_alvo_usuario
  );
$$;

-- 4 — função nova em public nasce com EXECUTE concedido NOMINALMENTE a anon
-- (ALTER DEFAULT PRIVILEGES do Supabase). Revogar de PUBLIC não alcança.
revoke execute on function
  public._profile_self_intacto(uuid, uuid, boolean, boolean, text, text, text)
  from anon;

-- 6 — LEITURA: é o que mantém as 6 telas que resolvem nome por user_id
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles for select to authenticated
  using (true);

-- 7 — ESCRITA DO ADMIN: sem restrição. Cobre settings/Users e o DELETE.
drop policy if exists profiles_escrita_admin on public.profiles;
create policy profiles_escrita_admin
  on public.profiles for all to authenticated
  using (public._is_admin())
  with check (public._is_admin());

-- 8 — AUTOSSERVIÇO: UPDATE da própria linha, colunas sensíveis congeladas
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (
    public._profile_self_intacto(user_id, id, is_admin, is_active, email,
                                 funcionario_alvo_codigo, alvo_usuario)
  );

-- 9 — AUTOSSERVIÇO: INSERT. Existe porque .upsert() avalia SEMPRE a WITH CHECK do
-- INSERT, mesmo virando UPDATE (bug 42501, PLANO-PROJETOS §7). Sem ela os 3 pontos
-- de escrita do frontend quebram. Linha nova por usuário comum segue bloqueada:
-- com perfil inexistente a função devolve FALSE (verificado: zero linhas → false).
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
  on public.profiles for insert to authenticated
  with check (
    public._profile_self_intacto(user_id, id, is_admin, is_active, email,
                                 funcionario_alvo_codigo, alvo_usuario)
  );

commit;

-- Delator do lote silencioso — TEM de vir 5 / true / false / 1
select (select count(*) from pg_policy where polrelid='public.profiles'::regclass)      as policies_agora,
       (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='_profile_self_intacto')                as func_security_definer,
       (select has_function_privilege('anon', p.oid, 'EXECUTE') from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='_profile_self_intacto')                 as func_anon_pode,
       (select count(*) from pg_policy where polrelid='public.profiles'::regclass
          and polname = 'Allow all for authenticated on profiles')                      as permissiva_ainda_no_lugar;


-- ═══════════════════════════════════════════════════════════════════════
-- ██ PASTE 3 — O PONTO DE NÃO-RETORNO (bloco 5), sozinho
-- Até aqui NADA mudou. Este DDL é a chave, e é atômico.
-- Se algo der errado depois: R5 do rollback recria a permissiva na hora.
-- ═══════════════════════════════════════════════════════════════════════
drop policy if exists "Allow all for authenticated on profiles" on public.profiles;

-- TEM de vir 4 / 0
select count(*)                                                              as policies_agora,
       count(*) filter (where polname = 'Allow all for authenticated on profiles') as permissiva_restante
from pg_policy where polrelid = 'public.profiles'::regclass;


-- ═══════════════════════════════════════════════════════════════════════
-- ██ PASTE 4 — bloco 10 + V1 + V2
-- ═══════════════════════════════════════════════════════════════════════

-- 10 — recarregar o schema cache do PostgREST
notify pgrst, 'reload schema';

-- V1 — as 4 policies, e nenhuma com true/true
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
where pol.polrelid = 'public.profiles'::regclass
order by 2, 1;

-- V2 — a função nasceu SECURITY DEFINER, STABLE, com search_path, fechada p/ anon
select p.proname,
       p.prosecdef                                      as security_definer,
       p.provolatile                                    as volatilidade,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '_profile_self_intacto';


-- ═══════════════════════════════════════════════════════════════════════
-- ██ PASTE 5 — BLOCO A + V3 · o REVOKE do anon, isolado
-- Independente de tudo acima. Hoje o RLS já barra o anon (não há policy para
-- esse role), então isto NÃO muda comportamento — existe para grant e policy
-- pararem de ficar empilhados na mesma peça: com o grant no lugar, desligar o
-- RLS por engano devolve escrita ao anon.
-- NÃO revoga de authenticated nem de service_role.
-- ═══════════════════════════════════════════════════════════════════════
revoke all on public.profiles from anon;

-- V3 — anon não pode mais aparecer
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles'
group by grantee
order by grantee;


-- ═══════════════════════════════════════════════════════════════════════
-- ██ PASTE 6 — V4 · PROVA FUNCIONAL. Tudo em BEGIN/ROLLBACK: nada é gravado.
--
-- 🔴 RODE DUAS VEZES — é o que separa "a policy funciona" de "o teste não testa":
--    · ANTES do PASTE 3  → (i) e (ii) TÊM de afetar **1 linha** cada.
--      É o controle: prova que o teste tem dentes. Se já der 0 aqui, o teste está
--      medindo outra coisa e o resultado de depois não vale nada.
--    · DEPOIS do PASTE 3 → (i) e (ii) TÊM de afetar **0 linhas**.
--
-- 🔴 (i) e (ii) são o CRITÉRIO DE ACEITE DO DESENHO, não só da policy. A premissa
--    não testada é que a função STABLE, dentro do WITH CHECK de um UPDATE, leia a
--    linha ANTIGA. Se ler a NOVA, a comparação vira nova-contra-nova, é sempre
--    verdadeira, e a policy não protege nada — parecendo instalada. V1 e V2
--    passariam igual. Só (i) e (ii) distinguem.
--    Se falhar: R5 imediato, e a saída é trocar o WITH CHECK por um trigger
--    BEFORE UPDATE, que recebe OLD e NEW e não depende de visibilidade MVCC.
--
-- ⚠️ O `set local role authenticated` é ESSENCIAL: `relforcerowsecurity` é false,
--    então o owner (postgres, que é quem o SQL Editor usa) BYPASSA o RLS. Sem
--    trocar de role, tudo passa e o teste não vale nada.
--
-- A = 9583eeeb-269e-4f46-9f2c-493761288d3c  ryan.santos@pfbrazil.com
--     único não-admin com alvo_usuario preenchido (RYAN.PAGANOTTO) — (ii) testa
--     PROTEGER identidade existente. must_change_password = true, então (vi)
--     exercita o caminho real do /reset-password.
-- B = 1cc3de88-0351-401b-86bb-fd519a5e2dd9  agente.compras@pfbrazil.com
--     conta de serviço, só como alvo alheio em (iii) e (iv) — raio de 1 linha.
-- ═══════════════════════════════════════════════════════════════════════
begin;

-- `auth.uid()` tenta PRIMEIRO a setting legada `request.jwt.claim.sub` (singular).
-- Limpar antes evita que um resíduo de outra sessão do editor decida quem é você.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims',
                  json_build_object('sub','9583eeeb-269e-4f46-9f2c-493761288d3c',
                                    'role','authenticated')::text,
                  true);
set local role authenticated;

-- confirma que o Postgres está mesmo enxergando o Ryan
select auth.uid() as quem_sou_eu;

-- (i) ESCALADA no próprio perfil
update public.profiles set is_admin = true
 where user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c';

-- (ii) IDENTIDADE FORJADA no próprio perfil
update public.profiles set alvo_usuario = 'ANA.SANCHES'
 where user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c';

-- (iii) PERFIL ALHEIO
update public.profiles set full_name = 'invadido'
 where user_id = '1cc3de88-0351-401b-86bb-fd519a5e2dd9';

-- (iv) DELETE ALHEIO
delete from public.profiles
 where user_id = '1cc3de88-0351-401b-86bb-fd519a5e2dd9';

-- (v) AUTOSSERVIÇO LEGÍTIMO
update public.profiles
   set full_name = full_name, must_change_password = must_change_password, updated_at = now()
 where user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c';

-- (vi) O UPSERT REAL do ResetPassword
insert into public.profiles (user_id, email, full_name, is_admin, is_active, must_change_password, updated_at)
select p.user_id, p.email, p.full_name, p.is_admin, p.is_active, false, now()
  from public.profiles p
 where p.user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c'
on conflict (user_id) do update
   set must_change_password = excluded.must_change_password,
       updated_at           = excluded.updated_at;

-- Fotografia antes de desfazer
select user_id, is_admin, is_active, alvo_usuario, full_name, must_change_password
  from public.profiles
 where user_id in ('9583eeeb-269e-4f46-9f2c-493761288d3c',
                   '1cc3de88-0351-401b-86bb-fd519a5e2dd9')
 order by user_id;

rollback;


-- ═══════════════════════════════════════════════════════════════════════
-- ██ ROLLBACK — NÃO EXECUTAR. Guardado à parte.
-- ═══════════════════════════════════════════════════════════════════════
-- -- R5 — a chave de volta. Recria a permissiva; desfaz o PASTE 3 sozinho.
-- create policy "Allow all for authenticated on profiles"
--   on public.profiles for all to authenticated using (true) with check (true);
--
-- -- R1..R4 — desfaz o PASTE 2 (só depois do R5, senão fica sem policy nenhuma)
-- drop policy if exists profiles_select_authenticated on public.profiles;
-- drop policy if exists profiles_escrita_admin        on public.profiles;
-- drop policy if exists profiles_self_update          on public.profiles;
-- drop policy if exists profiles_self_insert          on public.profiles;
--
-- -- R6 — desfaz o PASTE 5
-- grant select, insert, update, delete, truncate, references, trigger
--   on public.profiles to anon;
--
-- -- R7 — opcional; a função sozinha é inerte
-- drop function if exists
--   public._profile_self_intacto(uuid, uuid, boolean, boolean, text, text, text);
