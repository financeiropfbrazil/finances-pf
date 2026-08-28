-- =====================================================================
-- RLS de public.profiles — DIAGNÓSTICO E PROPOSTA
-- Preparado em 28/08/2026. Proposta para o Pedro aprovar e rodar.
-- ✅ **As duas perguntas de bloqueio foram medidas e deram ZERO** (§2-A):
--    nenhuma escalada e nenhum `alvo_usuario` alheio. ⇒ aplicar como MANUTENÇÃO,
--    não como resposta a incidente.
-- =====================================================================
--
-- ═══════════════════════════════════════════════════════════════════
-- 1. O QUE ESTÁ NO AR (medido pelo MCP em 28/08/2026, leitura)
-- ═══════════════════════════════════════════════════════════════════
--
-- RLS: LIGADO (relrowsecurity = true), sem FORCE.
-- Policies: **UMA SÓ**
--
--   "Allow all for authenticated on profiles"
--   FOR ALL  TO authenticated  USING (true)  WITH CHECK (true)
--
-- Grants de tabela:
--   authenticated   → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   anon            → SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER   ⚠️
--   service_role    → tudo (esperado)
--   klaus_readonly  → SELECT (leitor externo; fora do escopo, mas registrado)
--
-- Colunas: id, user_id, full_name, avatar_url, created_at, updated_at,
--          is_admin, is_active, email, funcionario_alvo_codigo, must_change_password,
--          alvo_usuario
--
-- ═══════════════════════════════════════════════════════════════════
-- 2. 🔴 O FURO É MAIOR DO QUE FALSIFICAÇÃO DE IDENTIDADE NO ERP
-- ═══════════════════════════════════════════════════════════════════
--
-- O card §14.4 levantou isto como "qualquer authenticated escreve `alvo_usuario` de
-- qualquer perfil" — identidade forjada no ERP. Verdade, e é o menor dos dois.
--
-- 🔴 `public._is_admin()` LÊ `profiles.is_admin`:
--
--     CREATE FUNCTION public._is_admin() RETURNS boolean
--       LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','auth'
--     AS $$ SELECT COALESCE((SELECT is_admin FROM public.profiles
--                            WHERE user_id = auth.uid()), false); $$
--
-- Com `USING(true) WITH CHECK(true)`, **qualquer usuário autenticado pode gravar
-- `is_admin = true` no próprio perfil.** Não é escalada de privilégio "em tese":
-- é um UPDATE de uma linha, pelo mesmo client que a tela já usa.
--
-- ALCANCE DE UM `is_admin` FORJADO (medido 28/08/2026):
--
--   | Superfície                                   | Quantidade |
--   |----------------------------------------------|-----------:|
--   | Usuários ativos NÃO-admin (quem pode fazer)   |     **56** |
--   | Policies de RLS que dependem de is_admin      |     **16** |
--   | Tabelas cobertas por essas policies           |      **8** |
--   | Funções do schema public que leem is_admin    |     **29** |
--   | Admins legítimos hoje                         |      **1** |
--
-- E o CLAUDE.md registra que o admin tem **bypass total** de permissão. Ou seja:
-- 56 pessoas a um UPDATE de distância do bypass do Hub inteiro.
--
-- 🔴 SEGUNDO: `FOR ALL` inclui **DELETE**. Hoje qualquer autenticado pode apagar
--    qualquer perfil — inclusive o do único admin.
--
-- 🔴 TERCEIRO: `anon` tem grants de escrita na tabela. Hoje o RLS o barra (não há
--    policy para `anon`), mas os dois controles estão empilhados na mesma peça: se
--    o RLS for desligado por engano, `anon` escreve. Grant e policy devem concordar.
--
-- ⇒ **Classificação: furo de CONTROLE DE ACESSO, não bug de dado.** Precede o card
--    §14.4 na fila, como o Pedro decidiu.
--
-- ═══════════════════════════════════════════════════════════════════
-- 2-A. ALGUÉM JÁ EXPLOROU?  ✅ NENHUM SINAL — É MANUTENÇÃO, NÃO INCIDENTE
--      (medido 28/08/2026 17:3x–17:41 UTC, leitura)
-- ═══════════════════════════════════════════════════════════════════
--
-- (a) ESCALADA PARA ADMIN — nenhuma.
--
--   | Perfis com is_admin = true                     |                     **1** |
--   | Quem                                           | pedro.scrignoli@pfbrazil.com |
--   | `updated_at` desse perfil                      |  **24/03/2026** (5 meses) |
--   | `created_at`                                   |            25/02/2026     |
--
--   É o perfil mais antigo da tabela e não é tocado desde março — anterior a toda a
--   operação de Suprimentos deste ano. **Nenhum outro perfil é admin.**
--
-- (b) `alvo_usuario` DE PERFIL ALHEIO — nenhum. São **5** perfis com o campo, e os 5
--     correspondem ao dono:
--
--   | e-mail                | alvo_usuario       | confere? |
--   |-----------------------|--------------------|----------|
--   | pedro.scrignoli@      | PEDRO.SCRIGNOLI    | ✅ |
--   | ana.sanches@          | ANA.SANCHES        | ✅ |
--   | mirlene.oliveira@     | MIRLENE.OLIVEIRA   | ✅ |
--   | elisangela.silva@     | ELISANGELA.SILVA   | ✅ |
--   | ryan.santos@          | **RYAN.PAGANOTTO** | ✅ — divergência **documentada**, não forjada: o `PLANO-PROJETOS` §A-9 registra exatamente este caso ("funcionário 0000063, nome ryan.santos, login RYAN.PAGANOTTO"), e o `funcionario_alvo_codigo` 0000063 bate |
--
--   Nenhum valor repetido entre pessoas. Nenhum perfil carregando login de outro.
--
-- (c) VERIFICAÇÃO DE **TRAJETÓRIA**, não só de estado — se alguém tivesse escalado,
--     provavelmente teria FEITO algo com o privilégio:
--
--   | Sinal                                              | Medido |
--   |----------------------------------------------------|--------|
--   | `compras_lideres_cc.atribuido_por` (só admin atribui) | só **pedro.scrignoli** e null |
--   | `user_permissions`                                  | **0 linhas** na tabela inteira |
--   | Perfis com `updated_at` nos últimos 120 dias        | 56, todos `is_admin = false`, e as edições batem com cadastro de funcionário/nome |
--
-- 🔴 **O QUE NÃO DÁ PARA PROVAR, e é parte do próprio achado:**
--    · `track_commit_timestamp` está **OFF** ⇒ não existe timestamp de commit por
--      linha. Não há como datar a última alteração de forma independente.
--    · **Não existe tabela de auditoria de `profiles`** (é o item 2 da Fase 2).
--    · `updated_at` é reescrito por qualquer update — não diz QUAL coluna mudou.
--    ⇒ Posso afirmar que **o estado de hoje está limpo e não há sinal em nenhuma das
--      fontes disponíveis**. NÃO posso afirmar que ninguém escalou e reverteu: essa
--      pergunta é **infalsificável com os dados que existem**, e é exatamente por
--      isso que a auditoria da Fase 2 importa.
--
-- ⇒ **Encaminhamento: aplicar como MANUTENÇÃO.** Nada aqui caracteriza incidente.
--
-- ═══════════════════════════════════════════════════════════════════
-- 2-B. O QUE PRECISA CONTINUAR FUNCIONANDO (levantado no código, não presumido)
-- ═══════════════════════════════════════════════════════════════════
--
-- LEITURA — `authenticated` lê perfis de OUTRAS pessoas em 7 pontos, sempre para
-- resolver nome a partir de user_id:
--   src/contexts/AuthContext.tsx           .select("*").eq("user_id", <próprio>)
--   src/pages/ProjetoRequisicoes.tsx       .select("user_id, full_name, email").in(...)
--   src/pages/SuprimentosAprovacoes.tsx    .select("user_id, full_name").in(...)
--   src/pages/SuprimentosRequisicaoDetalhe .select("user_id, full_name").in(...)
--   src/services/opService.ts              .select("user_id, full_name").in(...)  ×2
--   src/services/reqMatService.ts          .select("user_id, full_name").in(...)
--   src/services/pedidosService.ts         .select("alvo_usuario") por user_id e por email
-- ⇒ **Fechar o SELECT quebraria 6 telas.** A proposta MANTÉM o SELECT aberto a
--   `authenticated`: são nome/e-mail de colegas, dado interno. Fechar isso é outro
--   card, e não é o furo.
--
-- ESCRITA pelo frontend — só 3 pontos, todos `.upsert(..., {onConflict:"user_id"})`:
--   (a) src/pages/settings/Users.tsx:251   toggle ativo/inativo   — tela de ADMIN
--   (b) src/pages/settings/Users.tsx:304   editar nome/funcionário/alvo_usuario — ADMIN
--   (c) src/pages/ResetPassword.tsx:79     marca must_change_password=false no PRÓPRIO
--                                          perfil — e é **FALLBACK**: o caminho
--                                          primário é a RPC `hub_clear_must_change_password()`,
--                                          que existe, é SECURITY DEFINER e atualiza
--                                          só `must_change_password` e `updated_at`
--                                          de `auth.uid()`.
--
-- ESCRITA pelas Edge Functions (`admin-create-user-fin`, `hub-invite-user`,
-- `hub-reset-user-password`) usa `adminClient` = service_role ⇒ **bypassa RLS**.
-- Nada nelas é afetado por esta proposta.
--
-- 🔴 ARMADILHA QUE DECIDE O DESENHO — `.upsert()` avalia SEMPRE a WITH CHECK do
--    **INSERT**, mesmo quando a linha existe e a operação vira UPDATE. É o bug 42501
--    documentado no `PLANO-PROJETOS` §7 (*"Row proposed for insertion is checked
--    regardless of whether or not a conflict occurs"* — doc oficial). Portanto:
--    **uma proposta que só crie policy de UPDATE quebra os três pontos acima.**
--    A policy de INSERT precisa existir e aceitar o caso "upsert sobre linha própria".
--
-- ⚠️ E por que NÃO uso GRANT por coluna (a ferramenta óbvia): grant e policy são
--    AND. `authenticated` é o mesmo role para o admin e para todo mundo, então
--    revogar UPDATE de `is_admin` no nível de coluna tiraria a coluna **do admin
--    também**, quebrando a tela de Usuários. Column grant só serviria depois que a
--    escrita do admin saísse da tabela e fosse para RPC (Fase 2).
--
-- ═══════════════════════════════════════════════════════════════════
-- 3. A PROPOSTA — FASE 1: fecha o furo HOJE, com ZERO mudança de código
-- ═══════════════════════════════════════════════════════════════════
--
-- Ideia: o usuário comum continua podendo escrever a PRÓPRIA linha, mas as colunas
-- que carregam PODER (is_admin) ou IDENTIDADE (alvo_usuario, funcionario_alvo_codigo,
-- email, is_active) ficam **congeladas para ele** — a WITH CHECK exige que o valor
-- proposto seja IGUAL ao que já está lá. Quem muda essas colunas é o admin.
--
-- Como comparar "novo" com "velho" dentro de uma WITH CHECK: uma função
-- SECURITY DEFINER que lê a linha ATUAL de auth.uid() — o mesmo truque que o
-- `_is_admin()` já usa, e que evita recursão de RLS.
--
-- ✅ Os 3 pontos de escrita continuam funcionando:
--    (a) e (b) são do admin → caem na policy de admin, sem restrição de coluna.
--    (c) manda `is_admin`, `is_active` e `email` com os valores que leu do banco →
--        iguais aos atuais → passa. E se um dia parar de mandá-los, passa também.
--
-- ⚠️ O que passa a ser RECUSADO (é o objetivo):
--    · `is_admin = true` no próprio perfil          → escalada de privilégio
--    · `alvo_usuario` no próprio perfil             → identidade forjada no ERP
--    · qualquer escrita no perfil de OUTRA pessoa   → hoje é livre
--    · DELETE por não-admin                         → hoje é livre
--
-- ─────────────────────────────────────────────────────────────────
-- BLOCO 0 — PRÉ-VOO
-- ─────────────────────────────────────────────────────────────────
select current_database()                                  as db,
       (select count(*) from public.compras_pedidos)        as fp_pedidos,
       (select count(*) from public.profiles)               as fp_profiles,
       (select count(*) from public.profiles where is_admin) as fp_admins,
       now() at time zone 'UTC'                             as agora_utc;
-- Esperado: fp_profiles = 57, fp_admins = 1.
-- 🔴 Se fp_admins > 1, PARE: alguém já pode ter escalado. Investigue antes de fechar.


-- ─────────────────────────────────────────────────────────────────
-- BLOCO 1 — PREVIEW. Não escreve nada. Guarde a saída: é o rollback.
-- ─────────────────────────────────────────────────────────────────
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
       (select string_agg(r.rolname, ',') from pg_roles r where r.oid = any(pol.polroles)) as roles,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol where pol.polrelid = 'public.profiles'::regclass;

select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema='public' and table_name='profiles' group by grantee order by grantee;

-- Quem já tem valor nas colunas sensíveis (para conferir que nada se perde depois):
select count(*) filter (where is_admin)                              as admins,
       count(*) filter (where nullif(trim(alvo_usuario),'') is not null) as com_alvo_usuario,
       count(*) filter (where nullif(trim(funcionario_alvo_codigo),'') is not null) as com_funcionario,
       count(*) filter (where not coalesce(is_active,false))          as inativos
from public.profiles;


-- ─────────────────────────────────────────────────────────────────
-- BLOCO 2 — APPLY (Fase 1). Idempotente.
-- ⛔ NÃO EXECUTAR ATÉ O PEDRO APROVAR ESTE DESENHO.
-- ─────────────────────────────────────────────────────────────────
begin;

-- 2.1 — Helper: devolve as colunas SENSÍVEIS da linha ATUAL de quem está logado.
--       SECURITY DEFINER para não recursar no RLS de profiles (mesmo padrão do
--       `_is_admin()`, que já faz exatamente isso).
--       ⚠️ Regra 7 do PLANO-PROJETOS: `create or replace` NÃO preserva
--       SECURITY DEFINER nem search_path — os dois estão redeclarados abaixo.
create or replace function public._profile_self_congelado()
returns table (
  id                      uuid,
  is_admin                boolean,
  is_active               boolean,
  email                   text,
  funcionario_alvo_codigo text,
  alvo_usuario            text
)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select p.id, p.is_admin, p.is_active, p.email, p.funcionario_alvo_codigo, p.alvo_usuario
  from public.profiles p
  where p.user_id = auth.uid();
$$;

-- 🔴 Toda função nova em `public` nasce com EXECUTE concedido NOMINALMENTE a `anon`
--    (ALTER DEFAULT PRIVILEGES do Supabase). Revogar de PUBLIC não alcança grant
--    nominal — ver CLAUDE.md. Precisa da assinatura completa.
revoke execute on function public._profile_self_congelado() from anon;

-- 2.2 — Fora a policy única e permissiva.
drop policy if exists "Allow all for authenticated on profiles" on public.profiles;

-- 2.3 — LEITURA: continua aberta a authenticated. Ver §2-B: 6 telas resolvem nome
--       por user_id (§2-B). Fechar isto é outro card e não é o furo.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles for select to authenticated
  using (true);

-- 2.4 — ESCRITA DO ADMIN: sem restrição. Cobre as duas telas de settings/Users e
--       o DELETE. É a rede de segurança para o Pedro operar.
drop policy if exists profiles_escrita_admin on public.profiles;
create policy profiles_escrita_admin
  on public.profiles for all to authenticated
  using (public._is_admin())
  with check (public._is_admin());

-- 2.5 — AUTOSSERVIÇO (UPDATE): só a própria linha, e só as colunas que não
--       carregam poder nem identidade.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (id, is_admin, is_active, email, funcionario_alvo_codigo, alvo_usuario)
        is not distinct from
        (select c.id, c.is_admin, c.is_active, c.email, c.funcionario_alvo_codigo, c.alvo_usuario
           from public._profile_self_congelado() c)
  );

-- 2.6 — AUTOSSERVIÇO (INSERT): existe **por causa do `.upsert()`**, que avalia a
--       WITH CHECK do INSERT mesmo quando a linha já existe (bug 42501,
--       PLANO-PROJETOS §7). Mesma condição da 2.5: o upsert sobre a própria linha
--       passa; um INSERT de linha nova por usuário comum não passa, porque a
--       função devolve zero linhas e a comparação falha — criar perfil é papel das
--       Edge Functions (service_role).
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert
  on public.profiles for insert to authenticated
  with check (
    user_id = auth.uid()
    and (id, is_admin, is_active, email, funcionario_alvo_codigo, alvo_usuario)
        is not distinct from
        (select c.id, c.is_admin, c.is_active, c.email, c.funcionario_alvo_codigo, c.alvo_usuario
           from public._profile_self_congelado() c)
  );

-- 2.7 — `anon` não tem o que fazer nesta tabela. Grant e policy passam a concordar,
--       em vez de o RLS ser a única peça segurando.
revoke all on public.profiles from anon;

commit;

notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────
-- BLOCO 3 — VERIFY. Remedindo na hora; o "Success" não é evidência.
-- ─────────────────────────────────────────────────────────────────
-- (3a) As 4 policies existem, com os comandos certos e nenhuma `true/true`.
select pol.polname,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
            when 'd' then 'DELETE' when '*' then 'ALL' end as cmd,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from pg_policy pol where pol.polrelid='public.profiles'::regclass
order by 2, 1;
-- Esperado: 4 linhas. NENHUMA com cmd='ALL' e check_expr='true'.

-- (3b) O helper nasceu SECURITY DEFINER, com search_path, e fechado para anon.
select p.proname, p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='_profile_self_congelado';
-- Esperado: security_definer = true, proconfig com search_path, anon_pode = FALSE.

-- (3c) `anon` sem grants na tabela.
select grantee, string_agg(privilege_type, ',') as privs
from information_schema.role_table_grants
where table_schema='public' and table_name='profiles' group by grantee order by grantee;
-- Esperado: `anon` NÃO aparece.

-- (3d) 🔴 PROVA FUNCIONAL — a escalada precisa FALHAR. Roda em BEGIN/ROLLBACK.
--      Troque o UUID por um usuário NÃO-admin real (a §Regra 8 do PLANO-PROJETOS:
--      o Pedro é o único is_admin e tem bypass, então testar com ele NÃO prova nada).
begin;
  set local role authenticated;
  select set_config('request.jwt.claims',
         json_build_object('sub','<UUID-DE-UM-NAO-ADMIN>','role','authenticated')::text, true);

  -- (i) escalada: TEM de dar 0 linhas afetadas (ou erro de policy)
  update public.profiles set is_admin = true where user_id = '<UUID-DE-UM-NAO-ADMIN>';
  select 'escalada afetou ' || (select count(*) from public.profiles
          where user_id='<UUID-DE-UM-NAO-ADMIN>' and is_admin) || ' linha(s) — esperado 0' as v_escalada;

  -- (ii) identidade forjada: TEM de dar 0
  update public.profiles set alvo_usuario = 'ANA.SANCHES' where user_id = '<UUID-DE-UM-NAO-ADMIN>';

  -- (iii) perfil alheio: TEM de dar 0
  update public.profiles set full_name = 'invadido' where user_id <> '<UUID-DE-UM-NAO-ADMIN>';

  -- (iv) autosserviço legítimo: TEM de funcionar (1 linha)
  update public.profiles set full_name = full_name, must_change_password = must_change_password,
         updated_at = now() where user_id = '<UUID-DE-UM-NAO-ADMIN>';

  -- (v) DELETE alheio: TEM de dar 0
  delete from public.profiles where user_id <> '<UUID-DE-UM-NAO-ADMIN>';
rollback;

-- (3e) Depois de publicar: o fluxo real que mais assusta é a troca de senha
--      forçada (`/reset-password`) de um usuário NÃO-admin. O caminho primário é a
--      RPC; o fallback `.upsert()` passa a exigir que is_admin/is_active/email
--      venham iguais aos do banco — que é o que a tela lê. Testar com pessoa real
--      sem `is_admin`. **Um caminho feliz que nunca rodou não é caminho validado.**


-- ═══════════════════════════════════════════════════════════════════
-- 4. FASE 2 — o que a Fase 1 NÃO resolve (card próprio, exige código)
-- ═══════════════════════════════════════════════════════════════════
--
-- A Fase 1 fecha a escalada e a identidade forjada sem tocar em código, mas deixa
-- de pé o desvio de padrão que criou o problema:
--
--  1. **A escrita do admin continua indo direto na tabela.** O padrão do Hub
--     (D-4 do PLANO-PROJETOS) é RPC SECURITY DEFINER com gate de permissão, e
--     `settings/Users.tsx` usa `.upsert()`. Migrar para
--     `hub_admin_update_profile(...)` permitiria fechar INSERT/UPDATE/DELETE de
--     `authenticated` por completo — e AÍ column grants passam a ser utilizáveis.
--  2. **Não há auditoria de mudança de `is_admin`/`alvo_usuario`.** Hoje ninguém
--     saberia dizer quando um valor mudou nem quem mudou. Uma tabela
--     `profiles_auditoria` (molde `compras_pedidos_auditoria`, append-only como o
--     card B4) é o complemento natural — e é o que tornaria a Fase 1 falsificável.
--  3. **`klaus_readonly` tem SELECT** na tabela. É leitor externo; não muda com esta
--     proposta, mas fica registrado que ele enxerga e-mail de 57 pessoas.
--
-- ⚠️ E o de sempre: as 3 telas de escrita precisam ser exercitadas com usuário
--    **sem** `is_admin` depois do Publish. O Pedro tem bypass — erro de permissão
--    nunca aparece para ele.
--
-- ═══════════════════════════════════════════════════════════════════
-- 5. ROLLBACK — NÃO EXECUTAR. Só para guardar.
-- ═══════════════════════════════════════════════════════════════════
-- begin;
-- drop policy if exists profiles_select_authenticated on public.profiles;
-- drop policy if exists profiles_escrita_admin        on public.profiles;
-- drop policy if exists profiles_self_update          on public.profiles;
-- drop policy if exists profiles_self_insert          on public.profiles;
-- create policy "Allow all for authenticated on profiles"
--   on public.profiles for all to authenticated using (true) with check (true);
-- grant select, insert, update, delete, truncate, references, trigger
--   on public.profiles to anon;   -- ⚠️ restaura o estado inseguro; só se algo quebrar feio
-- commit;
-- drop function if exists public._profile_self_congelado();
