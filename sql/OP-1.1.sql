-- =====================================================================
-- OP-1.1 · Módulo Ordem de Produção · Fase 1 · SQL Editor (hbtggrbauguukewiknew)
-- ESTRUTURA APENAS: tabelas, trigger de updated_at, numeração.
-- Policies (RLS) + RPCs de escrita = OP-1.2. Verificação e rollback no fim (comentados).
--
-- PROTOCOLO: este arquivo é a FONTE CANÔNICA do bloco. Copiar DAQUI (do arquivo),
-- nunca do terminal/chat — o display colapsa linhas longas e corrompe o SQL.
--
-- Revisão de 4 olhos incorporada (pré-aplicação, 23/07/2026):
--  (a) op_proximo_numero(): CASE no retorno — lpad(txt,4,'0') TRUNCA à esquerda
--      quando o número passa de 4 dígitos (lpad('10000',4,'0')='1000' ⇒ colisão
--      silenciosa acima de 9999). Acima de 9999 devolve o número puro.
--  (b) op_set_updated_at(): SET search_path = public (hardening de função).
-- =====================================================================

-- 1) Tipos de OP (cadastro extensível — não é enum de código)
create table public.op_tipos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  ativo boolean not null default true,
  ordem int,
  created_at timestamptz not null default now()
);

insert into public.op_tipos (codigo, nome, ordem) values
  ('VALVULA','Válvulas',1), ('CATETER','Cateter',2), ('ENCAPSULAMENTO','Encapsulamento',3);

-- 2) Ordens de produção (cabeçalho)
create table public.op_ordens (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  numero_referencia text,
  tipo_id uuid not null references public.op_tipos(id),
  produto_familia text,
  tipo_ordem text not null check (tipo_ordem in ('FABRICACAO','EMBALAGEM_FINAL')),
  tipo_produto text not null check (tipo_produto in ('ACABADO','EM_PROCESSO')),
  destino text not null check (destino in ('INTERNACIONAL','NACIONAL','NAO_APLICAVEL')),
  lote text,
  data_inicio date,
  data_fim_planejada date,
  status text not null default 'RASCUNHO'
    check (status in ('RASCUNHO','ABERTA','EM_ANDAMENTO','EM_FECHAMENTO','FECHADA','CANCELADA')),
  observacoes text,
  emitido_por uuid not null,                       -- = auth.uid(); uuid puro, sem FK (padrão do repo)
  emitido_depto text,                              -- texto livre (profiles não tem setor)
  emitido_em timestamptz not null default now(),
  aprovado_por uuid, aprovado_depto text, aprovado_em timestamptz,
  comunicado_a text, comunicado_depto text, comunicado_em timestamptz,
  op_pai_id uuid references public.op_ordens(id),
  cancelada_por uuid, cancelada_em timestamptz, motivo_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_op_ordens_status on public.op_ordens(status);
create index idx_op_ordens_tipo   on public.op_ordens(tipo_id);

-- 3) Itens da OP — SNAPSHOT do produto na criação (sem FK ao catálogo:
--    produto pode mudar/inativar; o item preserva o que foi planejado)
create table public.op_ordem_itens (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.op_ordens(id) on delete cascade,
  sequencia int not null,
  codigo_produto text not null,                    -- SKU hierárquico do espelho (ex. 001.010.037)
  codigo_alternativo_produto text,                 -- código do FRM/operador (ex. 82110053)
  produto_nome text not null,                      -- snapshot de stock_products.nome_produto
  produto_unidade text,                            -- snapshot de stock_products.unidade_medida
  quantidade_planejada numeric(14,4) not null check (quantidade_planejada > 0),
  created_at timestamptz not null default now(),
  unique (op_id, sequencia)
);

-- 4) Numeração anual AAAA-NNNN (gerada pelo Hub na criação)
create table public.op_numeracao (
  ano int primary key,
  ultimo int not null default 0
);

-- SEED por reserva de faixa: 2026-0001..2026-0500 reservados ao processo manual
-- (FRM-07-11); o Hub emite de 2026-0501 em diante. No go-live o manual para.
-- ⚠️ Virada de ano: se a operação paralela cruzar para 2027, semear (2027, 500)
-- ANTES da 1ª OP de 2027 (senão a função cria (2027,0) e começa em 2027-0001).
insert into public.op_numeracao (ano, ultimo) values (2026, 500);

-- Gerador de número (SECURITY DEFINER: roda como owner e ignora RLS ao tocar op_numeracao)
create or replace function public.op_proximo_numero()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ano int := extract(year from now())::int;
  v_n   int;
begin
  insert into public.op_numeracao (ano, ultimo) values (v_ano, 0)
    on conflict (ano) do nothing;
  update public.op_numeracao set ultimo = ultimo + 1
    where ano = v_ano
    returning ultimo into v_n;
  -- lpad(txt,4,'0') TRUNCA à esquerda acima de 4 dígitos: CASE preserva o número inteiro
  return v_ano::text || '-' ||
    case when v_n > 9999 then v_n::text else lpad(v_n::text, 4, '0') end;
end $$;

-- 5) Histórico de status (append-only)
create table public.op_status_historico (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.op_ordens(id) on delete cascade,
  de text, para text not null, motivo text,
  usuario uuid not null,
  created_at timestamptz not null default now()
);
create index idx_op_status_historico_op on public.op_status_historico(op_id);

-- 6) Trigger de updated_at (padrão do repo: 1 função por módulo)
create or replace function public.op_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_op_ordens_updated_at
  before update on public.op_ordens
  for each row execute function public.op_set_updated_at();

-- 7) RLS habilitada SEM policies = deny-all até a OP-1.2 (estado seguro: nenhum
--    frontend usa estas tabelas ainda; o SQL Editor roda como postgres e ignora
--    RLS, então a verificação abaixo funciona).
alter table public.op_tipos            enable row level security;
alter table public.op_ordens           enable row level security;
alter table public.op_ordem_itens      enable row level security;
alter table public.op_numeracao        enable row level security;
alter table public.op_status_historico enable row level security;

-- =====================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =====================================================================
-- a) contagem das 5 tabelas (op_tipos = 3; demais = 0):
--   select 'op_tipos' t, count(*) n from public.op_tipos
--   union all select 'op_ordens', count(*) from public.op_ordens
--   union all select 'op_ordem_itens', count(*) from public.op_ordem_itens
--   union all select 'op_numeracao', count(*) from public.op_numeracao
--   union all select 'op_status_historico', count(*) from public.op_status_historico;
-- b) seed:  select * from public.op_numeracao where ano = 2026;
-- c) teste de op_proximo_numero() SEM consumir número:
--   begin;
--     select public.op_proximo_numero() as n1;   -- 2026-0501
--     select public.op_proximo_numero() as n2;   -- 2026-0502
--     select ultimo from public.op_numeracao where ano = 2026;  -- 502
--   rollback;
--   select ultimo from public.op_numeracao where ano = 2026;    -- de volta = 500
-- d) trigger:  select tgname from pg_trigger where tgrelid='public.op_ordens'::regclass and not tgisinternal;

-- =====================================================================
-- ROLLBACK (sem dados de produção ainda)
-- =====================================================================
-- drop trigger if exists trg_op_ordens_updated_at on public.op_ordens;
-- drop function if exists public.op_set_updated_at();
-- drop function if exists public.op_proximo_numero();
-- drop table if exists public.op_status_historico;
-- drop table if exists public.op_ordem_itens;
-- drop table if exists public.op_numeracao;
-- drop table if exists public.op_ordens;
-- drop table if exists public.op_tipos;
