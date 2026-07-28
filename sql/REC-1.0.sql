-- =============================================================================
-- REC-1.0 · Espelho do Laudo do Alvo  (módulo Recebimento)
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- FONTE (Alvo ERP, entidade Laudo):
--   POST laudo/GetListForComponents  → 21 campos (lista; NÃO traz o lote)
--   GET  Laudo/Load?codigoEmpresaFilial=1.01&numero=N  → detalhe (traz NumeroCtrlLote)
--
-- PRINCÍPIO 1: o Alvo é dono do dado. Esta tabela é ESPELHO — nenhuma coluna
-- é editada pelo Hub. A custódia física (bipe recebimento→inspeção) virá em
-- tabela SEPARADA e append-only, SEM quantidade própria (REC-2.x).
--
-- ESCOPO DO SYNC: status 'Emitido' E 'Concluído'.
--   'Emitido'   = aguardando liberação da Qualidade (a fila)
--   'Concluído' = liberado; permite medir o tempo de inspeção
-- =============================================================================


-- ─── 1. TABELA ───────────────────────────────────────────────────────────────
create table if not exists public.rec_laudos (
  -- chave natural (Alvo)
  codigo_empresa_filial          text        not null default '1.01',
  numero                         text        not null,

  -- ── de laudo/GetListForComponents (os 21 campos da lista) ──
  data_emissao                   timestamptz,
  codigo_entidade                text,                 -- sempre null no Alvo; fornecedor vem do MovEstq
  chave_movestq                  bigint,               -- movimento de ORIGEM (lançamento da NF)
  codigo_produto                 text,
  quantidade2                    numeric(18,9),
  codigo_prod_unid_med           text,
  posicao_prod_unid_med          integer,
  quantidade                     numeric(18,9),        -- QuantidadeProdUnidMedPrincipal
  codigo_funcionario             text,                 -- examinador (null enquanto Emitido)
  status                         text,                 -- Emitido | Concluído
  gera_rm_especifica             text,
  especie_documento              text,
  numero_documento               text,                 -- nº da NF de origem
  texto                          text,
  resultado_analise              text,                 -- Nenhum | Aprovado | Aprovado Parcial
  data_resultado                 timestamptz,
  codigo_loc_armaz               text,                 -- destino (001)
  quantidade_destruida_aprovada  numeric(18,9),
  quantidade_destruida_reprovada numeric(18,9),

  -- ── de Laudo/Load (enriquecimento; nulos até o Load rodar) ──
  sequencia_it_movestq           integer,
  numero_ctrl_lote               text,                 -- ÂNCORA do QR / da genealogia
  data_validade_ctrl_lote        date,
  data_recepcao                  timestamptz,          -- ⚠ preenchido na CONCLUSÃO, não na chegada
  quantidade_aprovada            numeric(18,9),
  quantidade_reprovada           numeric(18,9),
  quantidade_devolvida           numeric(18,9),
  data_devolvida                 timestamptz,
  valor_reprovado                numeric(18,2),
  texto_resultado                text,
  codigo_centro_ctrl             text,
  codigo_funcionario_responsavel text,

  -- ── controle do espelho ──
  sincronizado_em                timestamptz not null default now(),
  enriquecido_em                 timestamptz,          -- null = ainda sem Laudo/Load
  raw_lista                      jsonb,
  raw_load                       jsonb,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),

  constraint rec_laudos_pkey primary key (codigo_empresa_filial, numero)
);

comment on table  public.rec_laudos is
  'Espelho read-only da entidade Laudo do ERP Alvo. Um laudo = um lote de recebimento. Nenhuma coluna é editada pelo Hub.';
comment on column public.rec_laudos.chave_movestq is
  'Chave do MovEstq de ORIGEM (lançamento da NF, ControlaEstoque=Não). O movimento de ENTRADA (E0000163) traz este numero de laudo no campo Documento.';
comment on column public.rec_laudos.numero_ctrl_lote is
  'Lote interno da P&F. Criado no lançamento da NF, antes do laudo. Ancora o QR de custódia e a genealogia.';
comment on column public.rec_laudos.data_recepcao is
  'ATENÇÃO: no Alvo este campo é preenchido na CONCLUSAO do laudo (= data_resultado em 3 de 3 casos observados), nao na chegada fisica. A chegada real sera registrada na tabela de custodia do Hub.';
comment on column public.rec_laudos.enriquecido_em is
  'Timestamp do Laudo/Load. Null = registro veio so da listagem e ainda nao tem lote.';


-- ─── 2. ÍNDICES ──────────────────────────────────────────────────────────────
create index if not exists rec_laudos_status_idx         on public.rec_laudos (status);
create index if not exists rec_laudos_produto_idx        on public.rec_laudos (codigo_produto);
create index if not exists rec_laudos_movestq_idx        on public.rec_laudos (chave_movestq);
create index if not exists rec_laudos_documento_idx      on public.rec_laudos (numero_documento);
create index if not exists rec_laudos_data_emissao_idx   on public.rec_laudos (data_emissao desc);
create index if not exists rec_laudos_lote_idx           on public.rec_laudos (numero_ctrl_lote)
  where numero_ctrl_lote is not null;
-- fila de enriquecimento pendente (Laudo/Load ainda nao rodou)
create index if not exists rec_laudos_pend_enriq_idx     on public.rec_laudos (numero)
  where enriquecido_em is null;


-- ─── 3. TRIGGER DE updated_at ────────────────────────────────────────────────
-- Padrao da casa: cada modulo tem sua propria funcao set_*_updated_at
create or replace function public.rec_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_rec_laudos_updated_at on public.rec_laudos;
create trigger trg_rec_laudos_updated_at
  before update on public.rec_laudos
  for each row execute function public.rec_set_updated_at();


-- ─── 4. RLS ──────────────────────────────────────────────────────────────────
-- Sem permissao nova nesta etapa (decisao: tela admin-only ate o bipe existir).
-- RLS LIGADA + policy de SELECT so para admin. Sem policy de escrita:
-- quem grava e a Edge Function (service_role, que ignora RLS).
alter table public.rec_laudos enable row level security;

drop policy if exists rec_laudos_select_admin on public.rec_laudos;
create policy rec_laudos_select_admin
  on public.rec_laudos
  for select
  to authenticated
  using ( (select public._is_admin()) );   -- ⚠ CONFERIR a assinatura antes de aplicar


-- =============================================================================
-- VERIFICAÇÃO (rodar DEPOIS de aplicar)
-- =============================================================================
-- fingerprint do projeto (deve bater com o registrado na sessao)
--   select count(*) as fingerprint from compras_pedidos;
--
-- estrutura
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='rec_laudos'
--    order by ordinal_position;                          -- esperado: 39 colunas
--
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='rec_laudos'
--    order by 1;                                          -- esperado: 1 PK + 7 idx
--
--   select relrowsecurity from pg_class
--    where oid='public.rec_laudos'::regclass;             -- esperado: true
--
--   select policyname, cmd from pg_policies
--    where schemaname='public' and tablename='rec_laudos';-- esperado: 1 (SELECT)
--
--   select tgname from pg_trigger
--    where tgrelid='public.rec_laudos'::regclass and not tgisinternal;
--
--   select count(*) from rec_laudos;                      -- esperado: 0 antes do sync


-- =============================================================================
-- ROLLBACK (so se precisar desfazer)
-- =============================================================================
--   drop trigger if exists trg_rec_laudos_updated_at on public.rec_laudos;
--   drop table  if exists public.rec_laudos;
--   drop function if exists public.rec_set_updated_at();
