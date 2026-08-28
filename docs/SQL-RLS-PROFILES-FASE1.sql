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
-- ORDEM DE EXECUÇÃO:  0 → 1 → 2 → 3 → 4 → 6 → 7 → 8 → 9 → **5** → 10
-- Um comando por bloco. Confira a saída de cada um antes do seguinte.
--
-- 🔴 O DROP DA POLICY PERMISSIVA (BLOCO 5) É O PENÚLTIMO, NÃO O TERCEIRO.
--    Correção do Pedro em 28/08/2026, e ela evita uma INDISPONIBILIDADE que a
--    primeira versão deste arquivo teria causado:
--
--    Dropar a permissiva ANTES de criar as novas deixa `profiles` com **RLS ligado e
--    ZERO policies** para `authenticated`. RLS sem policy **nega tudo** — inclusive o
--    SELECT que o `AuthContext` faz no primeiro render. Entre um bloco e o seguinte,
--    executados à mão, essa janela é de segundos a minutos, e nela **o Hub inteiro
--    para para todo mundo**.
--
--    Criando as novas PRIMEIRO não há janela: policies permissivas são **OR-adas**,
--    então durante a sobreposição vale `true OR (as novas)` = `true`, isto é, o
--    comportamento de hoje, sem alteração nenhuma.
--
--    ⇒ **A mudança inteira é INERTE até o BLOCO 5.** Ele é a chave, e é atômico (um
--      único DDL). Parar antes dele deixa o banco exatamente na postura de hoje; o
--      rollback, nesse ponto, é só não continuar. Depois dele, é o R5.
-- =====================================================================


-- ██ BLOCO 0 — PRÉ-VOO ████████████████████████████████████████████████
select current_database()                                   as db,
       (select count(*) from public.compras_pedidos)         as fp_pedidos,
       (select count(*) from public.profiles)                as fp_profiles,
       (select count(*) from public.profiles where is_admin) as fp_admins;
-- Esperado: fp_profiles = 57, fp_admins = 1.
-- 🔴 fp_admins > 1 ⇒ PARE. Alguém pode ter escalado entre a medição e agora.


-- ██ BLOCO 1 — ESTADO ATUAL: policies. GUARDE A SAÍDA (é o rollback) █████
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
       (select string_agg(r.rolname, ',') from pg_roles r where r.oid = any(pol.polroles)) as roles,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
where pol.polrelid = 'public.profiles'::regclass;
-- Esperado: 1 linha — "Allow all for authenticated on profiles", ALL, true, true.


-- ██ BLOCO 2 — ESTADO ATUAL: grants. GUARDE A SAÍDA ██████████████████████
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles'
group by grantee
order by grantee;
-- Esperado: anon e authenticated com SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER;
-- service_role idem; klaus_readonly só SELECT.


-- ██ BLOCO 3 — APPLY · a função que congela as colunas sensíveis ████████
-- Compara a linha PROPOSTA com a linha ATUAL de auth.uid(), coluna a coluna.
-- SECURITY DEFINER para não recursar no RLS de `profiles` — mesmo padrão do
-- `_is_admin()`, que já faz isso e está em produção.
-- STABLE de propósito: num UPDATE, função STABLE enxerga o snapshot do início do
-- comando, ou seja, a linha ANTIGA. É disso que a comparação depende.
-- ⚠️ Regra 7 do PLANO-PROJETOS: `create or replace` NÃO preserva SECURITY DEFINER
--    nem search_path — os dois estão redeclarados.
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


-- ██ BLOCO 4 — APPLY · fechar a função para anon ████████████████████████
-- 🔴 Toda função nova em `public` nasce com EXECUTE concedido NOMINALMENTE a `anon`
--    (ALTER DEFAULT PRIVILEGES do Supabase). Revogar de PUBLIC não alcança grant
--    nominal — CLAUDE.md. Exige a assinatura completa.
revoke execute on function public._profile_self_intacto(uuid, uuid, boolean, boolean, text, text, text) from anon;


-- ██ BLOCO 5 — APPLY · remover a policy permissiva ██████████████████████
-- 🔴 **RODE ESTE POR ÚLTIMO, DEPOIS DO BLOCO 9.** É a chave que liga a mudança:
--    até aqui o `true/true` da policy antiga é OR-ado com as novas e nada mudou.
--    Rodar antes das novas deixaria `profiles` com RLS ligado e zero policies —
--    nega tudo, derruba o Hub para todos. Ver o cabeçalho de ORDEM DE EXECUÇÃO.
drop policy if exists "Allow all for authenticated on profiles" on public.profiles;


-- ██ BLOCO 6 — APPLY · LEITURA (segue aberta a authenticated) ████████████
-- É o que mantém as 6 telas que resolvem nome por user_id funcionando.
create policy profiles_select_authenticated
  on public.profiles for select to authenticated
  using (true);


-- ██ BLOCO 7 — APPLY · ESCRITA DO ADMIN (sem restrição) █████████████████
-- Cobre as duas telas de settings/Users e o DELETE. Rede de segurança do Pedro.
create policy profiles_escrita_admin
  on public.profiles for all to authenticated
  using (public._is_admin())
  with check (public._is_admin());


-- ██ BLOCO 8 — APPLY · AUTOSSERVIÇO: UPDATE da própria linha ████████████
create policy profiles_self_update
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (
    public._profile_self_intacto(user_id, id, is_admin, is_active, email,
                                 funcionario_alvo_codigo, alvo_usuario)
  );


-- ██ BLOCO 9 — APPLY · AUTOSSERVIÇO: INSERT (existe por causa do .upsert) █
-- 🔴 `.upsert()` avalia SEMPRE a WITH CHECK do INSERT, mesmo virando UPDATE — é o
--    bug 42501 documentado no PLANO-PROJETOS §7. Sem esta policy, os 3 pontos de
--    escrita do frontend quebram.
--    Linha nova por usuário comum continua bloqueada: com o perfil inexistente a
--    função devolve FALSE (verificado: "zero linhas → false").
create policy profiles_self_insert
  on public.profiles for insert to authenticated
  with check (
    public._profile_self_intacto(user_id, id, is_admin, is_active, email,
                                 funcionario_alvo_codigo, alvo_usuario)
  );


-- ██ BLOCO 10 — APPLY · recarregar o schema cache ███████████████████████
notify pgrst, 'reload schema';


-- =====================================================================
-- ██ BLOCO A — SEPARADO, para conferir isolado: REVOKE do anon ██████████
-- =====================================================================
-- Independente dos blocos de policy. Pode rodar antes, depois, ou nunca — nada
-- acima depende dele.
--
-- HOJE o RLS já barra o `anon` (não há policy para esse role), então este REVOKE
-- **não muda comportamento nenhum**. Ele existe para os dois controles pararem de
-- ficar empilhados na mesma peça: com o grant no lugar, desligar o RLS por engano
-- devolve escrita ao `anon`.
--
-- ⚠️ CONFIRA ANTES (deve listar `anon` com privilégios de escrita):
--    → é a saída do BLOCO 2.
--
-- ⚠️ NÃO revoga de `authenticated` nem de `service_role`. Só do `anon`.
revoke all on public.profiles from anon;


-- =====================================================================
-- ██ VERIFY — remedindo na hora. O "Success" não é evidência. ███████████
-- =====================================================================

-- ██ V1 — as 4 policies existem e nenhuma é `true/true` ██████████████████
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol
where pol.polrelid = 'public.profiles'::regclass
order by 2, 1;
-- Esperado: 4 linhas — ALL(admin), INSERT(self), SELECT(true), UPDATE(self).
-- 🔴 NENHUMA com cmd='ALL' e check_expr='true'.


-- ██ V2 — a função nasceu SECURITY DEFINER, com search_path, fechada p/ anon █
select p.proname,
       p.prosecdef                                   as security_definer,
       p.provolatile                                 as volatilidade,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '_profile_self_intacto';
-- Esperado: security_definer = true, volatilidade = 's' (STABLE),
--           proconfig com search_path, anon_pode = FALSE.


-- ██ V3 — `anon` sem grants na tabela (só se rodou o BLOCO A) ███████████
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'profiles'
group by grantee
order by grantee;
-- Esperado: `anon` NÃO aparece.


-- ██ V4 — PROVA FUNCIONAL. Em BEGIN/ROLLBACK: nada é gravado. ██████████
--
-- 🔴 (i) E (ii) SÃO O CRITÉRIO DE ACEITE DO **DESENHO**, NÃO SÓ DA POLICY.
--
--    A policy depende de uma premissa que **NÃO foi testada dentro de um UPDATE
--    real**: que a função `_profile_self_intacto`, sendo STABLE, enxergue a linha
--    **ANTIGA** quando chamada de dentro do `WITH CHECK`.
--
--    O que EU verifiquei, e como: a semântica de `EXISTS` + `IS NOT DISTINCT FROM`
--    (igual→true, diferente→false, zero linhas→false, null vs null→true), por SELECT
--    puro. Isso prova a COMPARAÇÃO, não a VISIBILIDADE.
--
--    O que eu NÃO verifiquei: se, durante o UPDATE, a função lê a linha antiga ou a
--    nova. O raciocínio é que uma função STABLE usa o snapshot do comando, e uma
--    tupla escrita pelo próprio comando não é visível a ele (regras de cmin/cmax),
--    sem `CommandCounterIncrement`. É o mesmo padrão do `_is_admin()`, que está em
--    produção — mas `_is_admin()` nunca lê a linha que está sendo alterada.
--
--    🔴 **SE A FUNÇÃO ENXERGAR A LINHA NOVA, a comparação vira nova-contra-nova, é
--    sempre verdadeira, e a policy NÃO PROTEGE NADA — parecendo instalada.** V1 e V2
--    passariam do mesmo jeito. **Só (i) e (ii) distinguem os dois mundos.**
--
--    · (i) e (ii) com **0 linhas** ⇒ o desenho está certo, empiricamente.
--    · (i) ou (ii) com **1 linha** ⇒ o desenho está errado. **Rode o R5 na hora**
--      (recriar a policy permissiva) e me chame: a saída é trocar o `WITH CHECK` por
--      um **trigger BEFORE UPDATE**, que recebe `OLD` e `NEW` explicitamente e não
--      depende de visibilidade MVCC nenhuma. É estritamente mais robusto; só não é a
--      primeira opção porque é mais peça em produção.
--
-- Os dois UUIDs abaixo são reais, ambos NÃO-admin e ativos:
--   A = 9583eeeb-269e-4f46-9f2c-493761288d3c  ryan.santos@pfbrazil.com
--       Escolhido de propósito: é o ÚNICO não-admin com `alvo_usuario` PREENCHIDO
--       (`RYAN.PAGANOTTO`), então (ii) testa proteger uma identidade que EXISTE, não
--       preencher uma vazia. E tem `must_change_password = true`, o que faz (vi)
--       exercitar o caminho real do `/reset-password`.
--   B = 1cc3de88-0351-401b-86bb-fd519a5e2dd9  agente.compras@pfbrazil.com
--       Conta de serviço, usada só como ALVO ALHEIO em (iii) e (iv) — raio de UMA
--       linha em vez de 56, como o Pedro pediu. Nada é gravado de qualquer forma,
--       mas 1 linha não trava a tabela inteira nem dispara trigger em massa.
begin;
  set local role authenticated;
  select set_config('request.jwt.claims',
                    json_build_object('sub','9583eeeb-269e-4f46-9f2c-493761288d3c',
                                      'role','authenticated')::text,
                    true);

  -- (i) ESCALADA no próprio perfil — TEM de afetar 0 linhas
  update public.profiles set is_admin = true
   where user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c';

  -- (ii) IDENTIDADE FORJADA no próprio perfil — TEM de afetar 0
  --      (Ryan hoje tem RYAN.PAGANOTTO; isto tentaria trocar por outro login real)
  update public.profiles set alvo_usuario = 'ANA.SANCHES'
   where user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c';

  -- (iii) PERFIL ALHEIO — TEM de afetar 0
  update public.profiles set full_name = 'invadido'
   where user_id = '1cc3de88-0351-401b-86bb-fd519a5e2dd9';

  -- (iv) DELETE ALHEIO — TEM de afetar 0
  delete from public.profiles
   where user_id = '1cc3de88-0351-401b-86bb-fd519a5e2dd9';

  -- (v) AUTOSSERVIÇO LEGÍTIMO — TEM de afetar 1
  update public.profiles
     set full_name = full_name, must_change_password = must_change_password, updated_at = now()
   where user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c';

  -- (vi) O UPSERT REAL do ResetPassword — TEM de passar sem erro
  insert into public.profiles (user_id, email, full_name, is_admin, is_active, must_change_password, updated_at)
  select p.user_id, p.email, p.full_name, p.is_admin, p.is_active, false, now()
    from public.profiles p
   where p.user_id = '9583eeeb-269e-4f46-9f2c-493761288d3c'
  on conflict (user_id) do update
     set must_change_password = excluded.must_change_password,
         updated_at           = excluded.updated_at;

  -- Fotografia antes de desfazer. `is_admin` e `alvo_usuario` TÊM de estar intactos:
  select user_id, is_admin, is_active, alvo_usuario, must_change_password
    from public.profiles
   where user_id in ('9583eeeb-269e-4f46-9f2c-493761288d3c',
                     '1cc3de88-0351-401b-86bb-fd519a5e2dd9');
rollback;
--
-- 🟢 PASSOU: (i)–(iv) com 0 linhas, (v) com 1, (vi) sem erro, e a fotografia com
--    `is_admin = false` e `alvo_usuario = RYAN.PAGANOTTO`.
-- 🔴 (i) ou (ii) com 1 linha ⇒ **DESENHO ERRADO** — R5 imediato, ver acima.
-- 🔴 (v) ou (vi) com erro de policy ⇒ a Fase 1 QUEBRA o autosserviço — R5 e me chame.


-- ██ V5 — depois do Publish: teste com gente de verdade ██████████████████
select email, must_change_password
from public.profiles
where must_change_password
order by email;
-- São 7 pessoas. É por elas que passa o único caminho de escrita de não-admin
-- (`/reset-password`). **Um caminho feliz que nunca rodou não é caminho validado.**


-- =====================================================================
-- ██ ROLLBACK — NÃO EXECUTAR. Guardado à parte. ████████████████████████
-- Devolve exatamente o estado do BLOCO 1 + BLOCO 2.
-- =====================================================================
-- -- R1
-- drop policy if exists profiles_select_authenticated on public.profiles;
-- -- R2
-- drop policy if exists profiles_escrita_admin on public.profiles;
-- -- R3
-- drop policy if exists profiles_self_update on public.profiles;
-- -- R4
-- drop policy if exists profiles_self_insert on public.profiles;
-- -- R5  ⚠️ restaura o estado INSEGURO. Só se algo quebrar feio.
-- create policy "Allow all for authenticated on profiles"
--   on public.profiles for all to authenticated using (true) with check (true);
-- -- R6  (só se tiver rodado o BLOCO A)
-- grant select, insert, update, delete, truncate, references, trigger
--   on public.profiles to anon;
-- -- R7  (opcional — a função sozinha é inerte)
-- drop function if exists public._profile_self_intacto(uuid, uuid, boolean, boolean, text, text, text);


-- =====================================================================
-- FASE 2 — o que a Fase 1 NÃO resolve (card próprio, exige código)
-- =====================================================================
-- 1. **A escrita do admin continua indo direto na tabela.** O padrão do Hub (D-4 do
--    PLANO-PROJETOS) é RPC SECURITY DEFINER com gate de permissão, e
--    `settings/Users.tsx` usa `.upsert()`. Migrar para `hub_admin_update_profile(...)`
--    permitiria fechar INSERT/UPDATE/DELETE de `authenticated` por completo — e só
--    então GRANT por coluna passa a ser utilizável (hoje não é: grant e policy são
--    AND, e `authenticated` é o mesmo role do admin).
-- 2. **Não há auditoria de mudança de `is_admin`/`alvo_usuario`.** É o que torna
--    "ninguém escalou e reverteu" infalsificável. Uma `profiles_auditoria`
--    append-only (molde do card B4) é o complemento natural.
-- 3. **`klaus_readonly` tem SELECT** na tabela — leitor externo, enxerga e-mail de 57
--    pessoas. Não muda com esta proposta; fica registrado.
