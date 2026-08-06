-- =============================================================================
-- OP-2.4 · RLS das tabelas de RM: aceitar TAMBÉM `producao.rm.access`
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- ESCOPO: SOMENTE as 4 policies de SELECT abaixo. Nenhuma tabela, coluna,
-- função, índice ou grant é criado, alterado ou removido aqui. Nenhuma policy
-- de ESCRITA é criada — a criação de RM é etapa seguinte e virá por RPC
-- SECURITY DEFINER com gate `producao.rm.create`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE MUDA
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoje (OP-2.2), as 4 tabelas leem por:
--     (select user_has_permission(auth.uid(), 'producao.access'))
--
-- Passam a ler por:
--     (select user_has_permission(auth.uid(), 'producao.access'))
--  OR (select user_has_permission(auth.uid(), 'producao.rm.access'))
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE AMPLIAR, E NÃO TROCAR
-- ─────────────────────────────────────────────────────────────────────────────
-- As permissões `producao.rm.*` foram criadas em 06/08/2026 e mapeadas
-- EXATAMENTE aos mesmos papéis de `producao.access` (admin, gestor_producao,
-- operador_producao). Logo, HOJE, trocar e ampliar dão o mesmo resultado:
-- ninguém ganha nem perde acesso. A diferença aparece no primeiro papel
-- assimétrico, e aí:
--
--   • TROCAR por `producao.rm.access` quebraria quem tem só `producao.access`:
--     perderia a leitura das RMs sem nenhum aviso.
--
--   • O papel `almoxarife` proposto na §10.23 (access + view_all + atender, SEM
--     `producao.access`) seria barrado pela RLS e veria a TELA VAZIA — o modo de
--     falha mais caro, porque "nenhuma requisição" e "você não pode ver as
--     requisições" ficam indistinguíveis na tela.
--
-- Falha silenciosa é a mais cara. Ampliar é aditivo: nenhum caminho existente
-- muda de resultado, e o caminho futuro passa a funcionar.
--
-- ⚠ O gate FINO continua no frontend (rota + menu por `producao.rm.access`).
--   A RLS é o piso de segurança do dado, não o controle de navegação.
--
-- ⚠ `user_has_permission` já dá bypass a `profiles.is_admin` — não é preciso
--   tratar admin aqui (é a mesma função que as policies atuais usam).
--
-- ⚠ O `(select ...)` em volta da chamada é DELIBERADO e vem da OP-1.2: força o
--   InitPlan a avaliar a função UMA VEZ por consulta, não uma vez por linha.
--   Preservado nas duas pernas do OR.
-- =============================================================================

begin;

-- O drop+create roda dentro da transação de propósito: RLS habilitada SEM
-- policy é deny-all, e sem `begin/commit` haveria uma janela em que qualquer
-- SELECT concorrente (a tela de RM, o consolidado da OP) voltaria vazio.
-- Mesmo cuidado da REC-1.2 com o CHECK de `sync_runs`.

-- ─── 1. ESPELHO · CABEÇALHO ──────────────────────────────────────────────────
drop policy if exists op_reqmat_select on public.op_reqmat;
create policy op_reqmat_select on public.op_reqmat
  for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'producao.access'))
    or (select public.user_has_permission(auth.uid(), 'producao.rm.access'))
  );

-- ─── 2. ESPELHO · ITENS ──────────────────────────────────────────────────────
drop policy if exists op_reqmat_itens_select on public.op_reqmat_itens;
create policy op_reqmat_itens_select on public.op_reqmat_itens
  for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'producao.access'))
    or (select public.user_has_permission(auth.uid(), 'producao.rm.access'))
  );

-- ─── 3. ESPELHO · LOTES ──────────────────────────────────────────────────────
drop policy if exists op_reqmat_lotes_select on public.op_reqmat_lotes;
create policy op_reqmat_lotes_select on public.op_reqmat_lotes
  for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'producao.access'))
    or (select public.user_has_permission(auth.uid(), 'producao.rm.access'))
  );

-- ─── 4. LIVRO DO HUB (vínculo OP↔RM) ─────────────────────────────────────────
-- Entra junto porque a tela de RM e o consolidado da OP leem as duas famílias
-- na mesma renderização: deixar o livro fora produziria a metade pior do bug —
-- lista de RMs completa e coluna "OP" sempre vazia, que é EXATAMENTE o retrato
-- correto do vazamento hoje e passaria despercebido como defeito de permissão.
drop policy if exists op_requisicoes_select on public.op_requisicoes;
create policy op_requisicoes_select on public.op_requisicoes
  for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'producao.access'))
    or (select public.user_has_permission(auth.uid(), 'producao.rm.access'))
  );

commit;

-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =============================================================================
-- a) as 4 policies existem, são de SELECT, para `authenticated`, e o predicado
--    cita as DUAS permissões:
--
--   select c.relname            as tabela,
--          p.polname            as policy,
--          p.polcmd             as cmd,           -- 'r' = SELECT
--          p.polroles::regrole[] as roles,        -- {authenticated}
--          pg_get_expr(p.polqual, p.polrelid) as predicado
--     from pg_policy p
--     join pg_class c on c.oid = p.polrelid
--    where c.relname in ('op_reqmat','op_reqmat_itens','op_reqmat_lotes','op_requisicoes')
--    order by c.relname;
--
--   Esperado nas 4 linhas: cmd = 'r', roles = {authenticated}, e o predicado
--   contendo 'producao.access' E 'producao.rm.access'.
--
-- b) contagem de policies por tabela (tem de continuar 1 por tabela — este
--    bloco NÃO cria policy de escrita):
--
--   select c.relname, count(*)
--     from pg_policy p join pg_class c on c.oid = p.polrelid
--    where c.relname in ('op_reqmat','op_reqmat_itens','op_reqmat_lotes','op_requisicoes')
--    group by c.relname;
--
-- c) RLS continua habilitada e SEM force (o `op_reqmat_aplicar_load` da OP-2.3 é
--    SECURITY DEFINER e roda como owner; ligar FORCE RLS quebraria o sync EM
--    SILÊNCIO — aviso herdado da OP-2.3):
--
--   select relname, relrowsecurity, relforcerowsecurity
--     from pg_class
--    where relname in ('op_reqmat','op_reqmat_itens','op_reqmat_lotes','op_requisicoes');
--
--   Esperado: relrowsecurity = true, relforcerowsecurity = false.
--
-- d) prova funcional de que ninguém perdeu acesso — os papéis que já liam
--    continuam lendo (as duas permissões estão nos mesmos papéis hoje):
--
--   select r.codigo as papel,
--          bool_or(p.codigo = 'producao.access')    as tem_modulo,
--          bool_or(p.codigo = 'producao.rm.access') as tem_rm
--     from hub_roles r
--     join hub_role_permissions rp on rp.role_id = r.id
--     join hub_permissions p on p.id = rp.permission_id
--    where p.codigo in ('producao.access','producao.rm.access')
--    group by r.codigo order by r.codigo;
--
--   Esperado em 06/08/2026: admin, gestor_producao e operador_producao com
--   tem_modulo = true e tem_rm = true nos três.

-- =============================================================================
-- ROLLBACK (volta ao predicado da OP-2.2 — só `producao.access`)
-- =============================================================================
-- begin;
--   drop policy if exists op_reqmat_select on public.op_reqmat;
--   create policy op_reqmat_select on public.op_reqmat
--     for select to authenticated
--     using ((select public.user_has_permission(auth.uid(), 'producao.access')));
--
--   drop policy if exists op_reqmat_itens_select on public.op_reqmat_itens;
--   create policy op_reqmat_itens_select on public.op_reqmat_itens
--     for select to authenticated
--     using ((select public.user_has_permission(auth.uid(), 'producao.access')));
--
--   drop policy if exists op_reqmat_lotes_select on public.op_reqmat_lotes;
--   create policy op_reqmat_lotes_select on public.op_reqmat_lotes
--     for select to authenticated
--     using ((select public.user_has_permission(auth.uid(), 'producao.access')));
--
--   drop policy if exists op_requisicoes_select on public.op_requisicoes;
--   create policy op_requisicoes_select on public.op_requisicoes
--     for select to authenticated
--     using ((select public.user_has_permission(auth.uid(), 'producao.access')));
-- commit;
