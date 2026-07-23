# PLANO-OP.md — Módulo Ordem de Produção (Financial Hub)

**Fonte de verdade do módulo OP. Autocontido: protocolo, decisões, modelo de dados, tarefas e diário vivem aqui.**
Complementa o CLAUDE.md (regras gerais do repo) — em conflito, o CLAUDE.md prevalece.

---

## 0. Protocolo de sessão do módulo OP (obrigatório)

**Início de toda sessão:**
1. Ler este arquivo integralmente antes de qualquer ação.
2. Cumprir o início de sessão do CLAUDE.md: `git pull origin main` primeiro (Pedro pode ter alterado via Lovable entre sessões — se vierem commits do Lovable, listar antes de seguir), conferir remote/branch, e se for usar Supabase: projeto `hbtggrbauguukewiknew` confirmado por fingerprint.
3. Identificar a tarefa a executar (ex.: "OP-1.3"). Se o Pedro não indicou, perguntar. Nunca retomar tarefa de sessão anterior sem confirmação explícita.
4. Conferir a seção 2 (Status): o que está CONCLUÍDA não se refaz; o que está BLOQUEADA tem o motivo anotado.

**Durante:**
- Uma tarefa por vez. Antes de executar: problema → causa → impacto → solução → risco.
- Nunca assumir schema: ler `information_schema`/amostras antes de escrever qualquer SQL ou service.
- Tarefas registradas neste plano são **imutáveis** — mudanças entram como tarefas novas (Ajuste/Correção), preservando a original.
- **Banco:** MCP do Supabase é read-only. Toda DDL/DML sai daqui como bloco revisado → Pedro cola no **SQL Editor** → confirmação empírica (SELECT) antes de qualquer código que dependa dela. NUNCA `supabase db push`. Escritas de app em produção só via RPC `SECURITY DEFINER` com gate de permissão.
- **Blocos SQL para aplicação manual são gravados em arquivo no repo (`sql/OP-x.y.sql`) e copiados DO ARQUIVO, nunca do terminal/chat** — o display colapsa linhas longas e corrompe o SQL. O arquivo é a fonte canônica do bloco; o DDL espelhado neste plano (seção 3) deve bater com o arquivo. Pedro abre `sql/OP-x.y.sql` no editor e copia de lá para o SQL Editor.

**Fim de toda tarefa concluída (nesta ordem):**
1. Atualizar a seção 2 (Status) e registrar achados/decisões no Diário (seção 7).
2. Build limpo (`bun run build` — TS estrito, import órfão quebra).
3. Commit pequeno e descritivo **incluindo este arquivo** + `git push origin main`.
4. Push atualiza só o preview do Lovable — avisar o Pedro quando houver mudança de frontend pronta para **Publish manual**.

---

## 1. Visão do módulo

Controle de Ordens de Produção da P&F (dispositivo médico classe III/IV — rastreabilidade é requisito, não luxo). O fluxo replica e digitaliza o formulário **FRM-07-11** (fonte dos campos) e depois integra com o Alvo via ReqMat.

**Princípios:**
1. **Alvo é dono do estoque físico** — todo movimento de material (baixa/transferência/devolução) acontece via ReqMat no Alvo. O Hub orquestra, registra e reconcilia; nunca inventa saldo.
2. **Ledger imutável** — movimentos são append-only; correção = estorno integral referenciando o original + relançamento. Saldos são views.
3. **Extensível por dados** — tipos de OP, motivos de reprova/perda são cadastros, não enums de código.
4. **Rastreabilidade** — nº de OP em tudo; reason codes obrigatórios; trilha de status; campo `lote` previsto desde já (genealogia futura com Rastro P&F / `NumeroCtrlLote`).

**Equação de balanço (coração do módulo, Fases 2+):**
```
Disponibilizado = Σ Requisitado (ReqMat Retirada) − Σ Devolvido (ReqMat Devolução)
Disponibilizado = Consumido + Reprovado (Qualidade) + Perdas + Saldo em aberto (WIP)
```
No fechamento, saldo em aberto = 0 (sobras → ReqMat Devolução). Rendimento vs. BOM é camada analítica separada (variação pode existir; balanço físico não).

**Máquina de estados:**
```
RASCUNHO ──► ABERTA ──► EM_ANDAMENTO ──► EM_FECHAMENTO ──► FECHADA
     │           │             │                │
     └───────────┴─────────────┴────────────────┴──► CANCELADA
```
Transições permitidas (mapa completo, válido desde já): RASCUNHO→ABERTA · RASCUNHO→CANCELADA · ABERTA→EM_ANDAMENTO · ABERTA→CANCELADA · EM_ANDAMENTO→EM_FECHAMENTO · EM_ANDAMENTO→CANCELADA · EM_FECHAMENTO→EM_ANDAMENTO (reabrir) · EM_FECHAMENTO→FECHADA. Cancelamento exige motivo. Na Fase 1 a UI expõe apenas RASCUNHO→ABERTA e →CANCELADA; EM_ANDAMENTO passa a ser automático na Fase 2 (1ª requisição atendida).

**Fases:**
- **Fase 0** — Investigação ReqMat no Lab de API (Pedro conduz; roteiro na seção 6). Paralela, não bloqueia a Fase 1.
- **Fase 1** — Fundação interna ao Hub: DDL + RLS/RPCs + lista + modal de abertura + detalhe. **← ATUAL**
- **Fase 2** — Requisição de Materiais (erp-proxy: whitelist `ReqMat/Load` + rotas dedicadas com mapper; tela USER 2; espelho `op_requisicoes` + ledger `op_movimentos`). Bloqueada pelas questões da seção 5 e pela Fase 0.
- **Fase 3** — Qualidade (reprovas com motivo, validação contra saldo).
- **Fase 4** — Fechamento (BOM/proporções, wizard, ReqMat Devolução, relatório de yield/scrap, trava).
- **Fase 5** — Perdas avançadas, genealogia de lotes, custo por OP.

---

## 2. Status das tarefas

| Tarefa | Descrição | Status | Data | Notas |
|---|---|---|---|---|
| OP-1.0 | Reconhecimento read-only do terreno | CONCLUÍDA | 22/07/2026 | Achados e ajustes na seção 4.1. Timestamps EN (`created_at`/`updated_at`); permissões pontilhadas `modulo.recurso.acao`; espelho = `stock_products`; RLS Suprimentos aberta; `profiles` sem `setor`. |
| OP-1.1 | Migração: tabelas + seeds + numeração | CONCLUÍDA | 23/07/2026 | Aplicada e **verificada empiricamente via `pg_catalog` (MCP read-only, fingerprint 1686)**: 5 tabelas com RLS ligada (`op_ordens`=28 col, `op_ordem_itens`=9, `op_status_historico`=7, `op_tipos`=6, `op_numeracao`=2); contagens `op_tipos`=3, `op_numeracao`=1, demais=0; **seed 2026=500**; `op_proximo_numero()` SECURITY DEFINER + `search_path=public` + CASE `v_n>9999`; `op_set_updated_at()` `search_path=public`; trigger `trg_op_ordens_updated_at`; 4 CHECKs (status 6 estados, destino, tipo_ordem, tipo_produto). Bloco canônico: `sql/OP-1.1.sql`. |
| OP-1.2 | RLS + RPCs de escrita | CONCLUÍDA | 23/07/2026 | Aplicada (v2) e **verificada via `pg_catalog`** (fingerprint 1686): colunas `fechada_por`/`fechada_em`; 4 policies SELECT (`op_tipos`/`op_ordens`/`op_ordem_itens`/`op_status_historico`; `op_numeracao` deny-all); 3 permissões `producao.*` + papéis `operador_producao`(wiring=2)/`gestor_producao`(wiring=3); 5 RPCs `SECURITY DEFINER`+`search_path=public`; lockdown `op_proximo_numero` (execute=false p/ authenticated+anon), RPCs execute=true. Bloco: `sql/OP-1.2.sql`. |
| OP-1.3 | Frontend: seção Produção + lista de OPs | EM ANDAMENTO | 23/07/2026 | **Código pronto no preview do Lovable** (build limpo). Nav "Produção" gateada por `producao.access`, rota `/producao/ordens`, lista no molde `SuprimentosPedidos`, chips de contagem, filtros server-side, service `src/services/opService.ts`, status `src/lib/statusOP.ts`, permissões espelhadas em `constants/permissions.ts`. **Aguarda validação + Publish manual do Pedro.** |
| OP-1.4 | Modal de abertura (USER 1) | PENDENTE | | |
| OP-1.5 | Detalhe da OP + transições | PENDENTE | | |
| OP-1.6 | Validação ponta a ponta + Publish | PENDENTE | | |

Status possíveis: PENDENTE · EM ANDAMENTO · CONCLUÍDA · BLOQUEADA (com motivo).

---

## 3. Modelo de dados — Fase 1

Validado contra os formulários reais FRM-07-11 (OPs 2026-0007 Válvulas, 2026-0030 Encapsulamento, 2026-0056 Cateter). Uma OP produz **múltiplos SKUs** → tabela filha de itens.

**Decisões assumidas (reversíveis, registradas em 22/07/2026):**
- Sem gate de aprovação por ora: campos `aprovado_*` existem e são preenchíveis no detalhe, mas não travam o fluxo. Se virar gate, entra status `AGUARDANDO_APROVACAO` como Ajuste.
- `numero_referencia` (nullable) guarda o segundo número visto nos formulários (ex.: 2025-0183) até o Pedro confirmar o que é.
- Número gerado pelo Hub: formato `AAAA-NNNN`, sequência anual, atribuído na criação (inclusive rascunho); cancelada mantém o número (sem renumeração — trilha documental limpa). **Reserva de faixa:** 2026 semeado em `500` — manual usa 0001–0500, Hub emite de 0501+ (detalhe e regra de virada de ano em `op_numeracao`, seção 3).

### Tabelas

**`op_tipos`** — id uuid PK · codigo text UNIQUE (VALVULA/CATETER/ENCAPSULAMENTO) · nome text · ativo bool default true · ordem int · created_at.

**`op_ordens`** — id uuid PK · numero text UNIQUE (AAAA-NNNN) · numero_referencia text NULL · tipo_id FK→op_tipos · produto_familia text (hoje "Tricvalve") · tipo_ordem text CHECK (FABRICACAO|EMBALAGEM_FINAL) · tipo_produto text CHECK (ACABADO|EM_PROCESSO) · destino text CHECK (INTERNACIONAL|NACIONAL|NAO_APLICAVEL) · lote text NULL · data_inicio date · data_fim_planejada date NULL · status text CHECK (6 estados) default RASCUNHO · observacoes text · emitido_por uuid NOT NULL (profiles.user_id) · emitido_depto text · emitido_em timestamptz · aprovado_por/depto/em NULL · comunicado_a/depto/em NULL · op_pai_id FK→op_ordens NULL · cancelada_por/em/motivo_cancelamento NULL · **fechada_por/fechada_em NULL (adicionadas na OP-1.2 v2 — não vieram na OP-1.1)** · created_at · updated_at (trigger `op_set_updated_at`).

**`op_ordem_itens`** — id uuid PK · op_id FK→op_ordens (cascade) · sequencia int · **codigo_produto** text NOT NULL (SKU hierárquico do espelho, ex. `001.010.037`) · **codigo_alternativo_produto** text NULL (código do FRM, ex. `82110053`) · **produto_nome** text NOT NULL (snapshot) · **produto_unidade** text NULL (snapshot, ex. `UNID`) · quantidade_planejada numeric(14,4) CHECK >0 · created_at · UNIQUE(op_id, sequencia). Snapshot da casa, **sem FK** ao catálogo (produto pode mudar/inativar; o item preserva o que foi planejado).

**`op_numeracao`** — ano int PK · ultimo int default 0. Função `op_proximo_numero()` incrementa com lock de linha. **Numeração por reserva de faixa (decidido 22/07/2026): seed 2026 = `500`.** `2026-0001`..`2026-0500` ficam reservados ao processo manual (FRM-07-11); o Hub emite de `2026-0501` em diante. Não há "último número" estável porque manual e Hub emitem em paralelo até o go-live — no **go-live o processo manual para** e o Hub vira emissor único. ⚠️ **Virada de ano:** se a operação paralela cruzar para 2027, semear `(2027, 500)` (ou a folga vigente) **antes** da 1ª OP do ano — senão `op_proximo_numero()` cria `(2027,0)` e começa em `2027-0001`, colidindo com a faixa manual.

**`op_status_historico`** — id uuid PK · op_id FK (cascade) · de text NULL · para text · motivo text NULL · usuario uuid · created_at.

**Achado OP-1.1 (verificação read-only, 22/07/2026):** os 9 códigos do FRM-07-11 (`8211020031`…`8211010001`) casam **100% com `stock_products.codigo_alternativo`** (0 em `codigo_produto`, 0 em `codigo_reduzido`, 2 coincidências em `codigo_barras`). Todos são da família `001.010` (Tricvalve — "TRICUSPID VALVE …"), `ativo=true`, `unidade_medida='UNID'`. ⇒ **o picker (OP-1.4) busca por `codigo_alternativo` + `nome_produto` + `codigo_produto`**, exibindo os dois códigos; `codigo_barras` fica **fora da busca** (as 2 coincidências geram ambiguidade). O snapshot guarda `codigo_produto` (SKU interno hierárquico) **e** `codigo_alternativo_produto` (o código que o operador escreve no formulário).

### DDL final da OP-1.1 (validado contra o banco em 22/07/2026 — ajustes documentados na seção 4.1)

> **Fonte canônica: [`sql/OP-1.1.sql`](sql/OP-1.1.sql)** — copiar DO ARQUIVO para o SQL Editor (protocolo seção 0). O bloco abaixo é espelho e deve bater com o arquivo.
> **Revisão de 4 olhos (23/07/2026, pré-aplicação):** (a) `op_proximo_numero()` usa `case when v_n > 9999 then v_n::text else lpad(v_n::text,4,'0') end` — `lpad(...,4,...)` **trunca à esquerda** acima de 4 dígitos (`lpad('10000',4,'0')`=`'1000'` ⇒ colisão silenciosa); (b) `op_set_updated_at()` com `set search_path = public`.

```sql
-- =====================================================================
-- OP-1.1 · Módulo Ordem de Produção · Fase 1 · SQL Editor (hbtggrbauguukewiknew)
-- ESTRUTURA APENAS: tabelas, trigger de updated_at, numeração.
-- Policies (RLS) + RPCs de escrita = OP-1.2. Verificação e rollback no fim (comentados).
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
  -- lpad(txt,4,'0') TRUNCA à esquerda acima de 4 dígitos (lpad('10000',4,'0')='1000'
  -- ⇒ colisão silenciosa): CASE devolve o número inteiro quando passa de 9999.
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
--     select public.op_proximo_numero() as n1;   -- 2026-<seed+1>
--     select public.op_proximo_numero() as n2;   -- 2026-<seed+2>
--     select ultimo from public.op_numeracao where ano = 2026;  -- seed+2
--   rollback;
--   select ultimo from public.op_numeracao where ano = 2026;    -- de volta = seed
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
```

---

## 4. Tarefas da Fase 1 (detalhamento)

**OP-1.0 — Reconhecimento (read-only, nenhuma escrita).** Ler e registrar no Diário: (a) modelo de permissões vigente — assinatura real de `user_has_permission`, onde papéis/permissões são cadastrados, como Suprimentos gateia telas e RPCs; (b) nome e estrutura da tabela espelho de produtos (catálogo para o picker de SKU) e se há colunas de descrição/unidade; (c) se existe trigger genérico de `atualizado_em` reutilizável; (d) padrão de navegação/rotas/layout das telas existentes (Suprimentos como referência) e o padrão de service (`src/services/*`, `(supabase as any).rpc`); (e) padrão visual vigente (Bloomberg-calm, light+dark, tabular-nums). Saída: notas no Diário + ajustes necessários nos rascunhos das OP-1.1/1.2.

**OP-1.1 — Migração de estruturas.** Ajustar o rascunho da seção 3 conforme OP-1.0 (colisões de nome, conventions), obter do Pedro o último número de OP 2026 para o seed, entregar o bloco final → Pedro cola no SQL Editor → confirmar empiricamente (SELECT nas 5 tabelas + `select op_proximo_numero()` num BEGIN/ROLLBACK).

**OP-1.2 — RLS + RPCs de escrita.** Policies de leitura gateadas pela permissão de visualização do módulo; **sem policy de escrita direta** — toda escrita via RPC `SECURITY DEFINER` com gate: `op_criar_ordem(p_dados jsonb, p_itens jsonb) → uuid` (gera número, insere ordem RASCUNHO + itens, grava histórico NULL→RASCUNHO); `op_atualizar_rascunho(p_op_id, p_dados, p_itens)` (só em RASCUNHO); `op_transicao_status(p_op_id, p_para, p_motivo default null)` (valida o mapa de transições da seção 1, motivo obrigatório em cancelamento, carimba cancelada_*/histórico). Permissões do módulo: `op_visualizar` (leitura), `op_abrir` (criar/editar rascunho/abrir), `op_gerir` (cancelar, editar aprovado/comunicado) — nomes finais no padrão descoberto na OP-1.0. SQL redigido na sessão, mesmo fluxo: bloco → Pedro → SQL Editor → verificação.

**OP-1.3 — Seção Produção + lista de OPs.** Nova entrada de navegação "Produção" (gateada por `op_visualizar`), rota de lista: tabela com nº, tipo, tipo_ordem, itens (resumo: "3 SKUs · 45 un"), status (badge sóbrio), data início, emitido por. Filtros server-side: status, tipo, período, busca por número. Padrão visual do Hub.

**OP-1.4 — Modal de abertura (USER 1).** Campos do FRM-07-11: tipo de OP (select), tipo_ordem / tipo_produto / destino (grupos de opção), produto_familia (default "Tricvalve"), lote (opcional), data_inicio (default hoje), data_fim_planejada (opcional), numero_referencia (opcional), observações; grade de itens: busca de SKU no catálogo espelho, descrição (auto, editável — snapshot), quantidade planejada; mínimo 1 item. Ações: "Salvar rascunho" e "Salvar e abrir" (criar + transição ABERTA). emitido_por = usuário logado; emitido_depto texto livre (pré-preenchido se o profile tiver setor).

**OP-1.5 — Detalhe da OP.** Cabeçalho (número em destaque, badges de status/tipo), bloco de campos, tabela de itens planejados, timeline do histórico de status, ações condicionais por status/permissão: Editar (RASCUNHO), Abrir (RASCUNHO), Cancelar com motivo obrigatório (RASCUNHO/ABERTA), editar aprovado/comunicado (op_gerir). Abas de Requisições/Qualidade/Fechamento só nascem nas fases respectivas.

**OP-1.6 — Validação ponta a ponta.** Criar OP real de teste espelhando a 2026-0007 (3 SKUs), abrir, cancelar uma segunda de teste, conferir histórico e numeração sequencial, dark/light, permissões com usuário sem papel. Pedro faz o Publish no Lovable. Atualizar este arquivo e encerrar a fase.

---

## 4.1 — OP-1.0 · Reconhecimento do terreno (achados + ajustes aos rascunhos)

Executado em 22/07/2026, **read-only**, projeto `hbtggrbauguukewiknew` (fingerprint `compras_pedidos` = 1674). Fontes: banco (MCP read-only) + código do repo (módulo **Suprimentos** como referência).

### A) Modelo de permissões (Hub RBAC)
- **Função canônica:** `public.user_has_permission(p_user_id uuid, p_permission_code text) → bool` (SECURITY DEFINER, `search_path=public`). Lógica: `profiles.is_admin` ⇒ TRUE (bypass total); senão `EXISTS` em `hub_user_roles ur → hub_role_permissions rp → hub_permissions p` com `p.codigo = code` e `ur.revogado_em IS NULL`.
- **Wrapper por `auth.uid()`:** `public._user_has_perm(p_codigo text) → bool` (mesma lógica via `auth.uid()`, chama `_is_admin()`) — **gate ideal dentro de RPC/RLS**. Também: `_is_admin()`, `hub_caller_is_admin()`, `get_user_permissions(p_user_id) → setof(codigo)` (usado pelo AuthContext do front).
- **Catálogo:** `hub_permissions(id, codigo, nome, descricao, modulo, created_at)`. Papéis: `hub_roles(codigo, nome, descricao)` — hoje: admin, analista_fiscal, analista_compras, requisitante, aprovador_projetos, controller_intercompany, financeiro, responsavel_projeto, visualizador_compras, viewer_intercompany. **Nenhum de produção.**
- **Taxonomia real dos códigos:** `modulo.recurso.acao` — pontilhado, verbos em inglês. Ex. Suprimentos: `compras.pedidos.access|create|view_all|view_own|delete_draft`; `compras.requisicoes.access|create|view_all|view_own|delete_own|reenviar_own`. Módulos são palavra única (`compras`, `projetos`, `cartao`, `intercompany`, `ferramentas`; global `_global`).
- **Gate no frontend:** `PermissionRoute permKey="…"` inline em `src/App.tsx:118-140` via `usePermissions().hasAccess()` (`src/hooks/usePermissions.ts`); botões/ações via `useHasPermission(code)` (`src/hooks/useHasPermission.ts`); permissões carregadas no `AuthContext` por `get_user_permissions`; catálogo tipado em `src/constants/permissions.ts`. Não existe `<PermissionGate>`. Convivem RBAC pontilhado e "menu_keys" legados (`suprimentos_requisicoes`, mapeados em `usePermissions.ts:14-21`) — **módulo novo usa só RBAC pontilhado.**

### B) Espelho de produtos (picker de SKU)
- Tabela **`public.stock_products`** (20 col). Chaves p/ o picker: `codigo_produto` (SKU, NOT NULL) · `codigo_reduzido` · `nome_produto` (descrição, NOT NULL) · `unidade_medida` (ex. "UNID") · `familia_codigo` (ex. "001.016") · `ativo` (bool) · `controla_lote` · `codigo_barras`/`codigo_alternativo`. Usa `created_at`/`updated_at`. Códigos no formato `001.016.062`.
- **Mapa OP:** `op_ordem_itens.sku_codigo ← codigo_produto`; `descricao (snapshot) ← nome_produto`; sugerir coluna nova `unidade ← unidade_medida`. Picker filtra `ativo=true`, busca por codigo/nome.
- ⚠️ `stock_products.tipo_produto` é código numérico ("15","53") — domínio distinto do `op_ordens.tipo_produto` (ACABADO|EM_PROCESSO). Só homônimo, **sem conflito**.

### C) Trigger de `atualizado_em`
- **Não há genérico reutilizável.** Cada módulo tem função nomeada (`set_compras_requisicoes_updated_at`, `intercompany_set_updated_at`, `tg_blocos_set_updated_at`…), todas `NEW.updated_at = now()`, ligadas por `BEFORE UPDATE ... FOR EACH ROW` (ex. real: `trg_compras_requisicoes_updated_at`).
- **Convenção decisiva:** `created_at` (132 tabelas) / `updated_at` (76) vs `criado_em`/`atualizado_em` (**1 cada**) ⇒ o rascunho da OP (português) diverge; **adotar inglês**.

### D) Rotas / service / layout
- Rotas centralizadas em `src/App.tsx` (react-router v6): import estático no topo + `<Route path="/mod/recurso" element={<PermissionRoute permKey="…"><Pagina/></PermissionRoute>}/>` dentro do bloco `AppLayout` (`<Outlet/>`). Ex.: `/suprimentos/pedidos`, `/.../novo`, `/.../:id`.
- Nav em `src/components/AppSidebar.tsx`: array de sub-itens + `renderXGroup(...)` (Collapsible shadcn) + invocação condicional a `hasAccess("…")` no bloco de injeção (~linhas 261-308). Ícone lucide.
- Services em `src/services/*.ts` (funções, sem classe): `import { supabase } from "@/integrations/supabase/client"` + `(supabase as any).rpc("nome",{p_…})` (params `p_`) ou `(supabase as any).from("tbl")`. Mutations retornam `{sucesso, …, erro?}` ou lançam `Error(msg)`.
- **Leitura de lista:** em geral **inline** na página via `useQuery` + `(supabase as any).from("tbl").select("*",{count:"exact"}).order().range().ilike()/.gte()/.lte()` (ex. `SuprimentosPedidos.tsx`). Existe também RPC de lista SECURITY DEFINER (`suprimentos_listar_pedidos_para`) — as duas abordagens convivem. Precedente de numeração Hub-side anual: `sugerir_proximo_numero_invoice(p_ano)` (SECURITY DEFINER) ⇒ **valida** o approach de `op_proximo_numero()`.

### E) Padrão visual (Bloomberg-calm)
- Tokens HSL em `src/index.css` (manifesto linhas 5-17): 3 superfícies (`--surface-1/2/3`), accent único `--primary` (azul), semânticos dessaturados `--success/--warning/--danger/--info/--violet`; sem glow/glass/gradiente; só `shadow-sm`. `darkMode:["class"]` (`tailwind.config.ts`); **dark é default** (toggle caseiro `ThemeToggle`, sem next-themes). Tokens no formato `"H S% L%"` ⇒ usar tints `token/opacidade`, nunca cor hardcoded.
- Números: `font-variant-numeric: tabular-nums` global em `body`/`table` (index.css:150-165); colunas de valor `text-right tabular-nums whitespace-nowrap` (+ às vezes `font-mono`). **Sem util central de formatação** — replicar `formatBRL` local (`Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"})`, guarda null→"—").
- Status: fonte única `src/lib/statusConfig.ts` com helpers `ROUTINE(sem)`/`EXCEPTION(sem)` e `getStatus*()` → `{label, className, Icon, tooltip}` em `<Badge variant="outline" className={…}>`. Componentes-chave: `DataSection`+`Field` (`src/components/DataSection.tsx`); set shadcn completo em `src/components/ui/*` (Dialog p/ modais, Command p/ combobox/picker, Table, Card, Select, Popover+Calendar).

### Ajustes a aplicar aos rascunhos

**OP-1.1 (DDL):**
1. `criado_em`→`created_at`, `atualizado_em`→`updated_at` em todas as tabelas `op_*`.
2. Criar `public.op_set_updated_at()` (`NEW.updated_at=now()`) + `CREATE TRIGGER trg_op_ordens_updated_at BEFORE UPDATE ON op_ordens ... EXECUTE FUNCTION op_set_updated_at()`. (Só `op_ordens` precisa; filhas são append.)
3. `op_ordem_itens`: adicionar `unidade text` (snapshot de `unidade_medida`); `sku_codigo` ↔ `stock_products.codigo_produto`.
4. `emitido_por`: uuid puro (= `auth.uid()`), **sem FK** (padrão do repo — `hub_user_roles.user_id` etc.). Confirmar unicidade de `profiles.user_id` se quiser FK.
5. `op_proximo_numero()`: nascer `SECURITY DEFINER SET search_path='public'` (padrão Hub); lógica de lock mantida.
6. Sem colisão de prefixo `op_` (verificado). `produto_familia`/`tipo_produto` seguem texto/CHECK como no rascunho.

**OP-1.2 (RLS + permissões):**
1. Renomear p/ convenção pontilhada: `op_visualizar`→`producao.access`; `op_abrir`→`producao.ordens.create`; `op_gerir`→`producao.ordens.manage`. (Opcional `producao.ordens.view_all/view_own`.) Módulo `producao`.
2. INSERT em `hub_permissions(codigo,nome,descricao,modulo='producao')` + amarrar em `hub_role_permissions`. Decidir papéis (provável novo papel "Produção" em `hub_roles` + admin, que já bypassa). Espelhar em `src/constants/permissions.ts`.
3. RLS: recomendo **divergir** do precedente compras (policy aberta `FOR ALL USING(true)`) e usar `FOR SELECT TO authenticated USING (user_has_permission(auth.uid(),'producao.access'))`; **sem policy de escrita** (só RPC SECURITY DEFINER que bypassa RLS). Combina com a leitura inline `.from()`. **Decisão do Pedro.**
4. Gate nas RPCs via `_user_has_perm('producao.ordens.create')` (raise se falso); SECURITY DEFINER + `search_path`.

**OP-1.3/1.4/1.5 (frontend):**
- Molde de lista: `src/pages/SuprimentosPedidos.tsx`. Criar `src/lib/statusOP.ts` (ROUTINE/EXCEPTION + tokens) e `src/services/ordemProducaoService.ts`. Rota base `/producao/ordens`; nav `renderProducaoGroup` gateado por `producao.access` (ícone `Factory`/`ClipboardList`).
- Picker de SKU: `Command`/combobox sobre `stock_products` (`ativo=true`); busca por `codigo_alternativo` + `nome_produto` + `codigo_produto` (exibe ambos os códigos); `codigo_barras` **fora da busca** (ambiguidade). Descrição auto de `nome_produto`, unidade de `unidade_medida`.
- ⚠️ **Correção factual OP-1.4:** `profiles` **não tem** `setor`/`departamento` (só `full_name`, `email`, `is_admin`, `is_active`, `funcionario_alvo_codigo`, `alvo_usuario`) → `emitido_depto` é **texto livre puro, sem pré-preenchimento**.

---

## 5. Questões em aberto (bloqueiam Fases 2–4; respostas do Pedro)

1. **OP também no Alvo ou só no Hub?** O `ReqMat/Load` referencia `OrdProducObject` — se a P&F usar o módulo nativo de OP do Alvo, o Hub abre a OP lá e amarra; senão, vínculo via `Descricao`/`Texto` da ReqMat. Fase 0 (item 1) informa.
2. **Quem atende a requisição?** USER 2 pelo Hub (inserir + atender em sequência) ou almoxarifado no Alvo? Define quando o movimento entra no ledger e a permissão.
3. **Reprova movimenta estoque?** Só analítica (default proposto) ou transferência física para local segregado (ReqMat Transferência)?
4. **Como o produto acabado entra no estoque Alvo hoje?** Define a Fase 4 e o fluxo semi-acabado → Encapsulamento.
5. **Segundo número dos formulários** (2025-0183 etc.): referência do ano anterior ou resíduo de planilha? (Por ora: `numero_referencia`.)

---

## 6. Referência Alvo/ReqMat (para Fases 0 e 2+)

- Endpoints: `POST ReqMat/InserirAlterarRequisicaoMaterial` (payload `ReqMatIntegracaoApi`: header + `Itens[]`) · `POST ReqMat/AtenderTodosItensRequisicao` (**tudo-ou-nada** — favorece requisições pequenas e frequentes) · `GET ReqMat/Load` (loadParent inclui `OrdProducObject`, loadChild inclui `ItemReqMatChildList`) · `GET ReqMat/DeletarReqMat`.
- **O payload de integração NÃO expõe campo de OP** — vínculo OP↔ReqMat vive no Hub; nº da OP vai em `Descricao`/`Texto` (confirmar na Fase 0).
- ReqMat tipo **Devolução** = entrada no estoque → mecanismo de acerto das sobras no fechamento.
- Nenhum endpoint ReqMat está na whitelist do passthrough hoje (`ALLOWED_ENDPOINTS`, `erp-proxy/src/routes/alvo.ts`). Fase 2: whitelist `ReqMat/Load` + rotas dedicadas de escrita com mapper (`producao-reqmat-mapper.ts`), padrão dos `emit-*-mapper.ts`. Cuidado com constraints estilo DocFin (placeholders `-1`/`""`, erro 417) — capturar empiricamente.
- **Roteiro Fase 0 (Lab de API, Pedro):** (1) `ReqMat/Load?numero=<real>&loadParent=All&loadChild=All` → capturar resposta, ver se `OrdProduc` vem preenchido; (2) descobrir códigos de `CodigoTipoRequisicaoMaterial` (Retirada/Transferência/Devolução); (3) semântica de `Operacao`, `CodigoMix`/`CodigoDepositoMix`/`CodigoCatalogoMix`, `PosicaoUnidadeMedida`; (4) de-para `CodigoFuncionario` ↔ usuários do Hub; (5) `CodigoCentroControle`, depósitos e locais da produção; (6) inserir ReqMat de teste mínima sem atender → Alvo gera o `Numero`? Movimenta estoque? Formato real da resposta? → `DeletarReqMat` para limpar; (7) só então testar `Atender` combinado com o almoxarifado e observar o MovEstq.
- Constantes: filial `1.01` · gateway `https://erp-proxy.onrender.com` · chamadas do frontend sempre via gateway (CORS).

---

## 7. Diário de achados e decisões

| Data | Tarefa | Registro |
|---|---|---|
| 22/07/2026 | — | Plano criado. Decisões assumidas: sem gate de aprovação (campos preenchíveis, sem trava); `numero_referencia` nullable para o 2º número dos formulários; numeração AAAA-NNNN gerada pelo Hub na criação. Fonte dos campos: FRM-07-11 (OPs 2026-0007/0030/0056). |
| 22/07/2026 | OP-1.0 | Reconhecimento read-only concluído (fingerprint `compras_pedidos`=1674, projeto `hbtggrbauguukewiknew`). Detalhe completo + ajustes na **seção 4.1**. Principais achados: (1) timestamps EN `created_at`/`updated_at` são a convenção (132/76 tabelas vs 1 em pt) e não há trigger genérico — cada módulo tem `set_*_updated_at`; (2) permissões pontilhadas `modulo.recurso.acao` via `user_has_permission`/`_user_has_perm` + catálogo `hub_permissions`/`hub_roles` — os nomes `op_*` do plano viram `producao.*`; (3) espelho de produtos = `stock_products` (codigo_produto/nome_produto/unidade_medida/ativo); (4) RLS do Suprimentos é aberta (`USING(true)`), gate em RPC+front — OP-1.2 vai divergir p/ SELECT gateado; (5) `profiles` **sem** `setor` ⇒ `emitido_depto` texto livre (corrige OP-1.4); (6) molde de tela = `SuprimentosPedidos.tsx`, visual em `statusConfig.ts`/`DataSection`, leitura de lista inline via `useQuery`+`.from()`. |
| 22/07/2026 | OP-1.1 | Decisões do Pedro aplicadas ao DDL: módulo de permissão `producao` (rota `/producao`); RLS gateada por `producao.access` (policies só na OP-1.2); papéis novos `operador_producao` (access+create) e `gestor_producao` (access+create+manage), `is_system=false` (wiring na OP-1.2); timestamps `created_at`/`updated_at` + trigger `op_set_updated_at()`; itens em snapshot (`codigo_produto`, `codigo_alternativo_produto`, `produto_nome`, `produto_unidade`, `quantidade_planejada`), sem FK ao catálogo; `op_proximo_numero()` SECURITY DEFINER + `search_path=public`. **Verificação read-only:** os 9 códigos do FRM-07-11 batem **100% em `stock_products.codigo_alternativo`** (0 em `codigo_produto`/`codigo_reduzido`; 2 coincidências em `codigo_barras`), família `001.010` (Tricvalve, "TRICUSPID VALVE …"), `ativo=true`, `UNID` ⇒ picker (OP-1.4) busca `codigo_alternativo`+`nome_produto`. DDL final na seção 3. **Pendências para CONCLUÍDA: seed real de 2026 (`<PREENCHER>`) + aplicação no SQL Editor + verificação empírica.** RLS habilitada sem policies = deny-all seguro no intervalo (nenhum frontend usa as tabelas ainda; SQL Editor roda como postgres e ignora RLS). |
| 22/07/2026 | OP-1.1 | Seed definido: **`(2026, 500)` — reserva de faixa** (não há "último número" estável; manual e Hub emitem em paralelo). Regra: `2026-0001`..`0500` = processo manual (FRM-07-11); Hub emite de `2026-0501`. No **go-live o manual para** → Hub emissor único. ⚠️ **Virada de ano:** se a operação paralela cruzar 2027, semear `(2027, 500)` (ou folga vigente) antes da 1ª OP de 2027 — senão `op_proximo_numero()` cria `(2027,0)` e emite `2027-0001`, colidindo com a faixa manual. Endossado: deny-all até OP-1.2; lockdown de `op_proximo_numero()` (revogar EXECUTE público) na OP-1.2. `sequencia`+`UNIQUE(op_id,sequencia)` mantidos. Picker OP-1.4: busca `codigo_alternativo`+`nome_produto`+`codigo_produto` (exibe ambos); `codigo_barras` fora (ambiguidade). `<<SEED_2026>>`→`500` no bloco. **Pendente p/ CONCLUÍDA: aplicação no SQL Editor + verificação empírica.** |
| 23/07/2026 | OP-1.1 | **Sessão de sincronização.** `git pull` = up-to-date, sem commits do Lovable. **Detecção empírica do estado (MCP read-only, fingerprint `compras_pedidos`=1686):** `op_*` = **0 tabelas, 0 funções** (checado via `information_schema` + `pg_proc`/`pg_namespace` + regex de token) ⇒ **OP-1.1 NÃO aplicada**; banco limpo. **Revisão de 4 olhos incorporada ao bloco (pré-aplicação):** (a) `op_proximo_numero()` retorna `v_ano::text || '-' || case when v_n > 9999 then v_n::text else lpad(v_n::text,4,'0') end` — `lpad(txt,4,'0')` **trunca à esquerda** acima de 4 dígitos (`lpad('10000',4,'0')`=`'1000'`), gerando colisão silenciosa ao passar de 9999; (b) `op_set_updated_at()` ganha `set search_path = public`. **Regra de protocolo nova (seção 0):** blocos SQL de aplicação manual vivem em `sql/OP-x.y.sql` e são copiados DO ARQUIVO (o terminal colapsa linhas longas e corrompe o SQL). Criado **`sql/OP-1.1.sql`** (bloco canônico com as duas correções + seed 500). **Próximo passo: Pedro cola `sql/OP-1.1.sql` no SQL Editor**, depois roda a verificação empírica (contagem das 5 tabelas, seed, `op_proximo_numero()` em BEGIN/ROLLBACK, trigger) → OP-1.1 CONCLUÍDA e segue OP-1.2. |
| 23/07/2026 | OP-1.1 | **CONCLUÍDA.** Pedro aplicou no SQL Editor; confirmado empiricamente via `pg_catalog` (MCP read-only, fingerprint 1686): 5 tabelas com **RLS ligada** (`op_ordens`=28 col incl. `motivo_cancelamento`/`comunicado_em`/`cancelada_em`; `op_ordem_itens`=9; `op_status_historico`=7; `op_tipos`=6; `op_numeracao`=2); contagens `op_tipos`=3, `op_numeracao`=1 (**seed 2026=500**), demais=0; `op_proximo_numero()` `SECURITY DEFINER`+`search_path=public`+CASE `v_n>9999` (via `pg_get_functiondef`); `op_set_updated_at()` `search_path=public`; trigger `trg_op_ordens_updated_at`; 4 CHECKs (status 6 estados, destino, tipo_ordem, tipo_produto). Numerador testado ao vivo pelo Pedro (`2026-0501`/`0502`) e resetado a 500. |
| 23/07/2026 | OP-1.2 | **SQL redigido (sem executar nada no banco) → `sql/OP-1.2.sql`.** Schema RBAC lido ao vivo (não assumido): `hub_permissions.codigo` UNIQUE, `hub_roles.codigo` UNIQUE (`modulo` NOT NULL, `is_system` default false), `hub_role_permissions` liga por **`role_id`+`permission_id` (UUID)** com UNIQUE(role_id,permission_id) — wiring resolve `codigo→id` via subselect. Conteúdo: (1) 3 permissões `producao.access`/`producao.ordens.create`/`producao.ordens.manage` (descrições no padrão da casa); (2) papéis `operador_producao` (access+create) e `gestor_producao` (os três), `is_system=false`, módulo `producao`; (3) wiring idempotente `ON CONFLICT DO NOTHING`; (4) 5 policies **SELECT** gateadas por `user_has_permission(auth.uid(),'producao.access')`, **sem policy de escrita**; (5) RPCs `SECURITY DEFINER`+`search_path=public` com gate `_user_has_perm`: `op_criar_ordem` (nº via `op_proximo_numero`, ordem RASCUNHO+itens, histórico NULL→RASCUNHO, mín. 1 item), `op_atualizar_rascunho` (só status RASCUNHO, substitui cabeçalho+itens), `op_transicao_status` (valida o mapa da seção 1, gate por ação — avanço=create / cancelar·fechar·reabrir=manage, motivo obrigatório em CANCELADA, carimba `cancelada_*`); grants só `authenticated`; (6) **lockdown de `op_proximo_numero`** (revoke execute de public/anon/authenticated — só chamada por dentro de `op_criar_ordem`, que roda como owner). Idempotente e reexecutável; verificação + rollback comentados no arquivo. **Pendente para CONCLUÍDA:** Pedro cola `sql/OP-1.2.sql` no SQL Editor + verificação. Nota p/ frontend (OP-1.3+): espelhar as 3 permissões em `src/constants/permissions.ts`. |
| 23/07/2026 | OP-1.2 | **CONCLUÍDA.** Pedro aplicou o v2; confirmado via `pg_catalog` (fingerprint 1686): `fechada_por`/`fechada_em` presentes; **4 policies** SELECT (`op_tipos`/`op_ordens`/`op_ordem_itens`/`op_status_historico`), `op_numeracao` sem policy (deny-all) conforme desenho; **3 permissões** `producao.access`/`producao.ordens.create`/`producao.ordens.manage`; **2 papéis** `operador_producao` (wiring=2) e `gestor_producao` (wiring=3), `is_system=false`; **5 RPCs** (`op_criar_ordem`/`op_atualizar_rascunho`/`op_transicao_status`/`op_registrar_aprovacao`/`op_registrar_comunicacao`) todas `SECURITY DEFINER`+`search_path=public`; **lockdown** de `op_proximo_numero` OK (`has_function_privilege` authenticated=false, anon=false) e as 5 RPCs executáveis por `authenticated`. Nota histórica: a 1ª tentativa de aplicação não constava no banco (0 objetos) — reconferido e reaplicado antes de prosseguir. |
| 23/07/2026 | OP-1.3 | **Frontend: nav Produção + lista de OPs (código pronto no preview; build limpo).** Novos: `src/lib/statusOP.ts` (6 estados no padrão sóbrio, molde de `statusPedido.ts`), `src/services/opService.ts` (`listarOrdens`/`contarPorStatus`/`listarTipos`; leitura direta gateada pela RLS; resolve tipo, agregado de itens e nome do emissor via `profiles` em lote por `.in()`), `src/pages/ProducaoOrdens.tsx` (lista no molde `SuprimentosPedidos`: Nº tabular-nums, tipo, tipo_ordem, resumo "N SKUs · Q un", badge de status, data_inicio, emitido por; filtros server-side status/tipo/período/busca com persistência na URL, ordenação padrão `created_at desc`, chips de contagem por status clicáveis, empty state com "Nova OP"). Editados: `App.tsx` (rota `/producao/ordens` gateada por `PermissionRoute permKey="producao.access"`), `AppSidebar.tsx` (grupo colapsável "Produção" ícone `Factory`, injetado nos dois caminhos do bloco `nf_entrada` + guard ampliado para quem só tem `producao.access`), `constants/permissions.ts` (3 permissões `PRODUCAO_*` + papéis `OPERADOR_PRODUCAO`/`GESTOR_PRODUCAO`). "Nova OP"→toast (modal = OP-1.4); clique na linha→toast (detalhe = OP-1.5). **Aguarda Publish manual do Pedro.** Para ver a tela, um usuário precisa do papel `operador_producao`/`gestor_producao` (ou admin) — senão o menu/rota não aparecem (RBAC) e a RLS retorna vazio. | (sem executar nada; tarefa OP-1.2 é a mesma). Gate do `op_transicao_status` confirmado (abrir/iniciar=create; cancelar/avançar/fechar/reabrir=manage). **Achado empírico:** `fechada_por`/`fechada_em` **não existiam** em `op_ordens` (verificado: 28 colunas, sem elas — a OP-1.1 não as criou; não estavam "órfãs") ⇒ v2 adiciona no topo `alter table op_ordens add column if not exists fechada_por uuid / fechada_em timestamptz` (aditivo, nullable, 0 registros; rollback = drop column) e o ramo `p_para='FECHADA'` passa a carimbar `fechada_por=auth.uid()`/`fechada_em=now()` (antes caía no else genérico). **Duas RPCs novas** (gate `producao.ordens.manage`, SECURITY DEFINER + `search_path=public`, mesmo revoke public/grant authenticated): `op_registrar_aprovacao(p_op_id,p_depto)` → `aprovado_por/aprovado_em/aprovado_depto`; `op_registrar_comunicacao(p_op_id,p_comunicado_a,p_depto)` → `comunicado_a/comunicado_depto/comunicado_em`; ambas exigem OP existente e `status<>'CANCELADA'`. **Perf/segurança:** 4 policies de SELECT com gate em subselect `((select user_has_permission(auth.uid(),'producao.access')))` (InitPlan 1x/consulta, não 1x/linha); **`op_numeracao` perde a policy (deny-all; RLS segue habilitada)** — nenhuma tela lê o contador, RPCs acessam por dentro do definer ⇒ contagem de policies `op_*` = **4**. Verificação do arquivo ampliada: `has_function_privilege` (proxnum=false p/ authenticated+anon; 5 RPCs=true p/ authenticated), policies=4, e `pg_get_functiondef(_user_has_perm)`. **Evidência do gate interno:** `_user_has_perm(text)` é `STABLE SECURITY DEFINER search_path=public,auth`, usa **`auth.uid()`** (`hub_user_roles→hub_role_permissions→hub_permissions`, `revogado_em IS NULL`, bypass `_is_admin()`). Normalização `nullif(depto,'')` nas RPCs de aprovação/comunicação (padrão do arquivo). |
