-- =====================================================================
-- PROJ-L1 — Projetos: auditoria de eventos + coluna atualizado_por
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L1)
--
-- ESTADO: APLICADO em 07/08/2026 (verificado por leitura: projeto_eventos com
--         11 colunas, RLS on, 0 policies, 3 indices; atualizado_por criada).
--
-- COMO APLICAR: colar no SQL Editor do Supabase. NAO e migration do CLI —
--               este diretorio nunca deve ser usado com `supabase db push`
--               (historico de migrations divergente; ver CLAUDE.md).
-- Idempotente: pode rodar 2x sem erro.
-- =====================================================================

-- 1) Tabela de eventos -------------------------------------------------
create table if not exists public.projeto_eventos (
  id            uuid primary key default gen_random_uuid(),
  projeto_id    uuid not null references public.projetos(id) on delete cascade,
  requisicao_id uuid references public.projeto_requisicoes(id) on delete set null,
  evento        text not null,   -- 'pedido_criado','pedido_editado','pedido_excluido',
                                 -- 'pedido_enviado_alvo','teto_rejeitado',
                                 -- 'budget_enviado_aprovacao','budget_aprovado'
  fase          text,            -- 'budget' | 'actual'
  valor_antes   numeric,
  valor_depois  numeric,
  detalhes      jsonb,           -- diff de campos, motivo de rejeicao, numero_pedido_alvo...
  usuario_id    uuid,            -- auth.uid() de quem agiu
  usuario_email text,
  created_at    timestamptz not null default now()
);

comment on table public.projeto_eventos is
  'Auditoria por evento do modulo de Projetos (L1). Append-only: escrita exclusiva das RPCs SECURITY DEFINER do L2. Policy de SELECT entra no L3.';

-- 2) Indices -----------------------------------------------------------
create index if not exists idx_projeto_eventos_projeto_created
  on public.projeto_eventos (projeto_id, created_at desc);

create index if not exists idx_projeto_eventos_evento
  on public.projeto_eventos (evento);

-- 3) RLS ligado e SEM policy -------------------------------------------
-- authenticated fica sem SELECT e sem escrita ate o L3 criar a policy de
-- SELECT. As RPCs do L2 (SECURITY DEFINER, owner postgres) gravam por bypass.
alter table public.projeto_eventos enable row level security;

-- 4) projeto_requisicoes: quem editou por ultimo -----------------------
alter table public.projeto_requisicoes
  add column if not exists atualizado_por uuid;

-- 5) PostgREST ---------------------------------------------------------
notify pgrst, 'reload schema';

-- 6) Verificacao por leitura -------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='projeto_eventos')                  as tabela_existe,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='projeto_eventos')                  as qtd_colunas,
  (select relrowsecurity from pg_class
    where oid = to_regclass('public.projeto_eventos'))                             as rls_on,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='projeto_eventos')                     as qtd_policies,
  (select count(*) from pg_indexes
    where schemaname='public' and tablename='projeto_eventos')                     as qtd_indices,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='projeto_requisicoes'
      and column_name='atualizado_por')                                            as coluna_nova,
  (select count(*) from public.projeto_requisicoes)                                as fingerprint_pedidos;
-- Esperado: 1 | 11 | true | 0 | 3 | 1 | 23

-- =====================================================================
-- ROLLBACK (nada depende do L1 ate o L2 existir):
--   drop table if exists public.projeto_eventos;
--   alter table public.projeto_requisicoes drop column if exists atualizado_por;
--   notify pgrst, 'reload schema';
-- =====================================================================
