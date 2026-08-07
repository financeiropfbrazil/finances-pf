# PLANO-PROJETOS.md — Módulo de Projetos (Budget → Aprovação → Actual) — v2

> **Documento vivo.** Claude Code: leia no início de toda sessão de Projetos; atualize status (seção 3) e diário (seção 8) ao concluir cada item. **Nunca alterar item registrado** — mudanças viram itens novos (Ajuste/Correção). v2 de 07/08/2026 (v1 era nota de diagnóstico — histórico absorvido na seção 7).
>
> **MISSÃO DESTA VERSÃO: refatorar o CRUD de pedidos do módulo de Projetos para o padrão moderno do Hub** (RPC `SECURITY DEFINER` + gate de permissão + tabelas fechadas no RLS + auditoria própria para reports), matando o bug 42501 do Actual pela raiz. Refatoração autorizada pelo Pedro **sem medo de quebrar** — o módulo tem 1 projeto real ("Congresso Rio Valves") e 10 linhas de pedidos; é a hora certa de reconstruir a fundação.
>
> **ESTADO EM 07/08/2026:** diagnóstico completo (seção 7). Bug ativo: Ana (não-admin) não consegue salvar pedido no Actual — o `.upsert()` avalia a WITH CHECK da policy de INSERT (só-Budget) mesmo na edição. Decisões do Pedro já tomadas: CRUD completo do Responsável no Actual · teto orçamentário **no banco** (RPC) · pedido enviado ao Alvo imutável p/ não-admin · exclusão só rascunho/erro. Nenhum lote executado ainda.

---

## 0. Regras (herdam o PLANO-PEDIDOS, com as diferenças marcadas ⚡)

1. Um lote por vez; **problema → causa → impacto → solução → risco** antes de executar; aprovação do Pedro em todo ponto de escrita **no banco**.
2. ⚡ **Escrita de CÓDIGO liberada ao agente** (validado FH47): editar arquivos do repo, staging individual (`git add <arquivo>`), commit, **push na `main`** → Lovable sincroniza. Proibido `git add -A` / `git add .` / `git commit -a`. `git status` antes de cada commit (working tree compartilhado). `src/integrations/supabase/types.ts` em skip-worktree — **nunca tocar**. Push = preview no editor Lovable; **app publicado exige Publish manual do Pedro**.
3. ⚡ **Escrita de BANCO continua na mão do Pedro** (SQL Editor). O agente entrega o SQL pronto (migration completa, com dry-run `BEGIN/ROLLBACK` onde aplicável), o Pedro roda e cola o resultado. MCP Supabase é **read-only** (`read_only=true`) — usar para diagnóstico e verificação pós-migration.
4. Build antes de push: `bun run build` E `tsc --noEmit -p tsconfig.app.json` (o build sozinho NÃO type-checka — achado 31/07 do PLANO-PEDIDOS). `eslint` não pode introduzir problema novo (comparar com HEAD).
5. **Migration antes de query de teste.** Nunca assumir schema — ler antes de escrever. Após DDL: `NOTIFY pgrst, 'reload schema';`.
6. **Após qualquer DDL, RELER `pg_policies`/`pg_proc` REAL** antes de declarar concluído. O SQL Editor abandona transações multi-statement — `COMMIT` isolado, depois verificação por leitura. (Lição da sessão de 07/08: um `CREATE POLICY` "confirmado" por SELECT de teste não estava persistido.)
7. `CREATE OR REPLACE FUNCTION` **não preserva** `SECURITY DEFINER` nem `SET search_path` — sempre redeclarar os dois. Mudança de assinatura exige `DROP FUNCTION` antes (evita overload duplicado).
8. **Teste final SEMPRE com usuário não-admin** (Ana). Pedro é o único `is_admin=true` (bypass total) — erro de permissão NUNCA aparece para ele (Permissoes_v2 §9.3).
9. Helpers de permissão: usar a família **`_user_has_perm('x')` / `_is_admin()`** (a que Projetos e OP já usam). Não misturar com `user_has_permission(auth.uid(),'x')` na mesma policy/RPC.

## 0.5. Pre-flight Supabase (obrigatório antes de qualquer query)

Projeto: **`hbtggrbauguukewiknew`**. Pedro tem OUTROS projetos Supabase — verificar por evidência:
1. URL do MCP contém `project_ref=hbtggrbauguukewiknew` e `read_only=true`; divergiu → PARE.
2. Fingerprint (primeira query da sessão):
   ```sql
   select
     (select count(*) from information_schema.tables where table_schema='public'
        and table_name in ('projetos','projeto_requisicoes','projeto_pedido_auditoria')) as tabelas_modulo,
     (select count(*) from projetos) as total_projetos,
     (select count(*) from projeto_requisicoes) as total_pedidos;
   ```
   → esperado `3 | 1 | 10` (ou mais, se a operação andou). `tabelas_modulo <> 3` = banco errado, PARE.
3. Registrar no diário que passou.

---

## 1. Modelo de negócio (fonte: Pedro, 07/08 — NÃO reinterpretar)

- **Responsável de Projeto** (`responsavel_projeto` — hoje: Ana Sanches, Pedro): cria o projeto, monta o Budget, envia para aprovação. **Depois de aprovado, faz CRUD COMPLETO no Actual** (criar, editar, excluir pedidos) e envia pedidos ao Alvo — **sempre respeitando o teto do orçamento**.
- **Aprovador de Projetos** (`aprovador_projetos` — hoje: Fernando Oliveira, Pedro): vê todos os projetos, aprova o Budget. **Não opera o Actual.**
- **Admin** (Pedro, único `is_admin`): vê/faz tudo, bypass.
- **Titularidade oficial: `responsavel_id`** — não `criado_por`. O RLS/RPCs antigos usavam `criado_por`; a refatoração corrige para `responsavel_id` (decisão do Pedro: "o Responsável do projeto" opera, independente de quem criou). `criado_por` permanece como registro histórico.

**Decisões fechadas (não reabrir sem item de Ajuste):**
| # | Decisão | Resposta |
|---|---|---|
| D-1 | Teto orçamentário no banco (RPC rejeita estouro) ou só no front? | **BANCO** — exceção consciente ao padrão do Hub ("o valor aqui é o limite que o diretor aprovou"). Front mantém a validação para UX. |
| D-2 | Pedido `status='enviado'` (já no Alvo): editável pelo Responsável? | **NÃO** — imutável para não-admin (padrão Cartões: linha emitida imutável). Admin pode. |
| D-3 | Exclusão de pedido: qualquer status? | **NÃO** — só `rascunho`/`erro`, nunca o que já foi ao Alvo (Hub e ERP não podem divergir). |
| D-4 | Padrão de gravação | **RPC `SECURITY DEFINER`** via POST (geração moderna: OP/Intercompany/Cartões). Zero `.upsert()`/`.update()`/`.insert()`/`.delete()` direto do front nas tabelas do módulo. |
| D-5 | Auditoria | **Tabela própria por evento** (seção 4, L1) para reports do controller. `projeto_pedido_auditoria` (desvios Actual×Budget) continua como está. |

---

## 2. Arquitetura-alvo (o "depois" da refatoração)

```
Front (ProjetoRequisicoes.tsx)
  │  supabase.rpc(...)  ← POST, nunca PATCH
  ▼
RPCs SECURITY DEFINER (gate _user_has_perm + responsavel_id + fase + teto)
  │  gravam projeto_requisicoes + projeto_eventos (auditoria)
  ▼
Tabelas fechadas no RLS (SELECT com escopo; INSERT/UPDATE/DELETE sem policy p/ authenticated = só via RPC)
```

- **SELECT** continua por policy (view_all p/ aprovador, view_own p/ responsável — corrigido p/ `responsavel_id`).
- **Escrita** perde as policies permissivas: fica **só** `_is_admin()` (rede de segurança p/ o Pedro operar direto no SQL Editor se precisar). Todo o resto escreve via RPC. É o padrão OP ("escrita 100% por RPC, tabelas sem policy de escrita").
- **Transições de fase** (`enviar_budget_para_aprovacao`, `aprovar_budget_projeto`) permanecem — ganham só a correção de gate (L2.4).

---

## 3. Lotes (registro imutável)

| Lote | Conteúdo | Repo | Status |
|---|---|---|---|
| L0 | Levantamento de schema + assinatura das RPCs existentes + snapshot pg_policies (baseline) | SQL/MCP read-only | ✅ 07/08 — baseline na seção 10 |
| L1 | Migration: tabela `projeto_eventos` + índices + colunas faltantes | SQL (Pedro executa) | ⬜ |
| L2 | RPCs novas: `projeto_pedido_salvar` · `projeto_pedido_excluir` · `projeto_pedido_marcar_enviado` + correção de gate das 2 RPCs de fase | SQL (Pedro executa) | ⬜ |
| L3 | RLS: refazer policies de `projetos` e `projeto_requisicoes` (escopo `responsavel_id`, escrita fechada) | SQL (Pedro executa) | ⬜ |
| L4 | Frontend: `projetosService.ts` novo + `ProjetoRequisicoes.tsx` chamando RPCs + botão Novo no Actual + erro completo | finances-pf (agente edita+push) | ⬜ |
| L5 | Reports: views `v_projeto_resumo` e `v_projeto_eventos_report` | SQL (Pedro executa) | ⬜ |
| L6 | Validação fim-a-fim com a Ana (não-admin) + Fernando (1º login + aprovação real) | operação real | ⬜ |

Ordem: **L0 → L1 → L2 → L3 → L4 → L5 → L6**. L3 só depois de L2 (as RPCs precisam existir antes de fechar a escrita, senão o módulo para). L4 só depois de L3 (o front novo pressupõe o banco novo).

---

## 4. Detalhe dos lotes

### L0 — Baseline (read-only; nada muda)
1. Snapshot integral: `select * from pg_policies where tablename in ('projetos','projeto_requisicoes','projeto_pedido_auditoria')` → colar no diário (é o "antes" para rollback).
2. `pg_proc`: assinatura + `prosecdef` + `proconfig` (search_path) de `enviar_budget_para_aprovacao` e `aprovar_budget_projeto`. **Obter o corpo** (`pg_get_functiondef`) — o L2.4 edita essas funções e ninguém tem o fonte delas em repo.
3. Schema real de `projetos` (colunas — confirmar `email_aprovacao_enviado_em`, `budget_aprovado_por/em`, `fase_atual`, `status`) e de `projeto_requisicoes` (já mapeado 07/08, conferir se mudou).
4. Confirmar helpers: corpo de `_user_has_perm(text)` e `_is_admin()` (`pg_get_functiondef`) — o L2 os replica no gate das RPCs novas.
5. Verificar se existe UNIQUE em `projeto_requisicoes (projeto_id, sequencia, fase)` — a RPC de salvar precisa saber como `sequencia` é gerada hoje (max+1? por fase?). Ler o front atual para confirmar quem atribui `sequencia`.
6. Ler `src/services/alvoProjetoPedidoService.ts` — mapear exatamente o que o pós-envio ao Alvo grava hoje (campos, status) para a RPC do L2.5 cobrir 1:1.

### L1 — Migration: auditoria de eventos + ajustes de schema (SQL, Pedro executa)
**Objetivo: tudo que acontece num projeto vira linha consultável — base dos reports do controller.**

1. **Tabela nova `projeto_eventos`** (auditoria por evento, molde `compras_pedidos_auditoria`):
   ```sql
   create table public.projeto_eventos (
     id uuid primary key default gen_random_uuid(),
     projeto_id uuid not null references public.projetos(id) on delete cascade,
     requisicao_id uuid references public.projeto_requisicoes(id) on delete set null,
     evento text not null,                -- 'pedido_criado','pedido_editado','pedido_excluido',
                                          -- 'budget_enviado_aprovacao','budget_aprovado',
                                          -- 'pedido_enviado_alvo','teto_rejeitado'
     fase text,                           -- 'budget' | 'actual'
     valor_antes numeric,
     valor_depois numeric,
     detalhes jsonb,                      -- diff de campos, motivo de rejeição, numero_pedido_alvo…
     usuario_id uuid,                     -- auth.uid() de quem agiu
     usuario_email text,
     created_at timestamptz not null default now()
   );
   create index on public.projeto_eventos (projeto_id, created_at desc);
   create index on public.projeto_eventos (evento);
   alter table public.projeto_eventos enable row level security;
   -- SELECT: mesmo escopo do projeto pai (admin OR view_all OR responsável/aprovador do projeto)
   -- ESCRITA: nenhuma policy p/ authenticated → só as RPCs (SECURITY DEFINER) inserem
   ```
   Policy de SELECT no L3 (junto com as demais). **`teto_rejeitado` é evento também** — tentativa de estourar orçamento fica registrada (ouro para report de controle).
2. **`projeto_requisicoes`:** adicionar `atualizado_por uuid` (quem editou por último — hoje só há `criado_por`). Nullable, sem backfill.
3. `NOTIFY pgrst, 'reload schema';` + verificação por leitura (Regra 6).

### L2 — RPCs (SQL, Pedro executa; agente escreve o SQL completo)
**Todas: `SECURITY DEFINER` + `SET search_path = public` explícitos. Gate no topo, RAISE com mensagem clara. Retornam a linha afetada em jsonb (padrão Cartões — dispensa releitura).**

1. **`projeto_pedido_salvar(p_projeto_id uuid, p_id uuid default null, p_dados jsonb) → jsonb`**
   Create (p_id null) e update (p_id preenchido) num só lugar. Sequência do gate:
   ```
   a) v_uid := auth.uid(); null → RAISE 'Não autenticado'
   b) admin? → pula p/ (f)
   c) _user_has_perm('projetos.pedidos.create') senão RAISE 'Sem permissão projetos.pedidos.create'
   d) projeto: v_proj := select ... for update;         -- lock: serializa contra duplo-clique
      v_proj.responsavel_id <> v_uid → RAISE 'Apenas o responsável do projeto pode gerenciar pedidos'
   e) fase coerente: p_dados->>'fase' deve = v_proj.fase_atual, e fase_atual in ('budget','actual')
      (budget_em_aprovacao → RAISE 'Budget em aprovação — edição bloqueada')
   f) se p_id preenchido: linha existe? pertence ao projeto?
      status='enviado' AND NOT admin → RAISE 'Pedido já enviado ao Alvo — somente administrador' (D-2)
      bloqueado=true AND NOT admin → RAISE 'Pedido bloqueado'
   g) TETO (D-1): v_total := soma valor_total das OUTRAS linhas da mesma fase do projeto
      (excluindo p_id se update). v_total + (p_dados->>'valor_total')::numeric > v_proj.orcamento
      → INSERT projeto_eventos('teto_rejeitado', detalhes com valores) + RAISE
        'Orçamento excedido: disponível R$ X' (mensagem com o saldo — o front exibe direto)
   h) rateio: se p_dados->'classe_rateio' não-vazio, soma percentual deve = 100 ±0.01 → senão RAISE
   i) INSERT ou UPDATE (campos permitidos: descricao, fornecedor_*, cond_pagamento_*, itens,
      classe_rateio, valor_total, fase, status [só rascunho na criação], atualizado_por=v_uid).
      Na criação: sequencia = coalesce(max(sequencia)+1,1) do projeto (conferir L0.5), criado_por=v_uid.
   j) INSERT projeto_eventos ('pedido_criado' | 'pedido_editado', valor_antes/depois, diff em detalhes)
   k) RETURN to_jsonb(linha)
   ```
2. **`projeto_pedido_excluir(p_id uuid) → jsonb`**
   Gate (a)–(d) igual; depois: linha existe; `status in ('rascunho','erro')` senão RAISE 'Só é possível excluir rascunho ou erro' (D-3); `bloqueado=false`; DELETE; evento `pedido_excluido` (com snapshot da linha em `detalhes`); retorna `{deleted: true, id, descricao}`.
3. **Eventos nas transições:** `enviar_budget_para_aprovacao` e `aprovar_budget_projeto` passam a inserir `projeto_eventos` (`budget_enviado_aprovacao`, `budget_aprovado`) — editar via `CREATE OR REPLACE` **redeclarando SECURITY DEFINER + search_path** (Regra 7), partindo do corpo capturado no L0.2.
4. **Correção de gate nas 2 RPCs de fase:** trocar a checagem `criado_por` por `responsavel_id` (em `enviar_budget_para_aprovacao`; a mensagem de erro já diz "responsável" — o código passa a fazer o que a mensagem promete). Em `aprovar_budget_projeto`, conferir que o gate é `aprovador_id = auth.uid()` + `projetos.approve` (deve estar; confirmar no corpo do L0.2).
5. **Envio ao Alvo:** `enviarRequisicaoAlvo` (front→erp-proxy) permanece; mas o pós-envio que grava `numero_pedido_alvo`/`status='enviado'`/`enviado_alvo_em` no Hub migra para RPC **`projeto_pedido_marcar_enviado(p_id uuid, p_numero_alvo text, p_sucesso boolean, p_erro text default null) → jsonb`** (mesmo padrão `marcar_arquivo_req_enviado` de Suprimentos: "via RPC para contornar bloqueio de PATCH"). Evento `pedido_enviado_alvo`. Campos exatos conforme L0.6.
6. Dry-run de cada RPC: `BEGIN; select projeto_pedido_salvar(...); ROLLBACK;` com JWT simulado (`set_config('request.jwt.claims', json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489')::text, true)`) — Ana em cenário feliz e em cenário de estouro de teto (esperar o RAISE + verificar que o evento `teto_rejeitado` seria inserido).

### L3 — RLS: refazer policies (SQL, Pedro executa)
**Só depois do L2 aplicado e verificado** (senão a escrita morre sem substituto).

1. `projeto_requisicoes`: **DROP** das policies de INSERT/UPDATE/DELETE atuais. Criar:
   - `pr_escrita_admin`: `FOR ALL ... USING (_is_admin()) WITH CHECK (_is_admin())` — rede de segurança; usuários comuns escrevem só via RPC.
   - `pr_select`: reescrever com escopo por **`responsavel_id`**: `_is_admin() OR EXISTS (projeto pai onde view_all OR (view_own AND (responsavel_id=auth.uid() OR aprovador_id=auth.uid())))`.
2. `projetos`:
   - SELECT `view_own`: `criado_por` → **`responsavel_id OR aprovador_id`** (fecha a divergência UI×RLS de vez; `criado_por` sai do escopo de visão).
   - UPDATE/DELETE: manter transições via RPC; a policy de UPDATE direto fica `_is_admin()` + o ramo do aprovador se a RPC de aprovação não cobrir (conferir no L0.2 se `aprovar_budget_projeto` faz o UPDATE por dentro — se sim, o ramo do aprovador na policy pode sair).
   - INSERT (criar projeto): mantém `projetos.create` + `criado_por=auth.uid()` (criação de projeto continua fluxo normal do front — está funcionando e não é o alvo desta refatoração).
3. `projeto_eventos`: policy de SELECT (escopo do projeto pai); zero policy de escrita.
4. Verificação por leitura do `pg_policies` completo (Regra 6) + `NOTIFY pgrst`.

### L4 — Frontend (agente edita + push; Publish manual do Pedro)
1. **`src/services/projetosService.ts` (novo):** `salvarPedido(projetoId, id|null, dados)` → `supabase.rpc('projeto_pedido_salvar',…)`; `excluirPedido(id)`; `marcarEnviado(...)`. Tratamento de erro completo: `{ code, message, details, hint }` (nunca só `.message` — achado do diagnóstico 07/08). Mensagens de RAISE das RPCs são amigáveis por design (g) — exibir direto no toast.
2. **`ProjetoRequisicoes.tsx`:**
   - `handleSave` → `projetosService.salvarPedido` (remove o `.upsert()` e a montagem de `payload.id`).
   - `handleDelete` → `projetosService.excluirPedido` (remove `.delete()` direto).
   - Pós-envio ao Alvo em `handleEnviarAlvo` → `marcarEnviado` (conforme L2.5).
   - Botão "Novo" do Actual: `faseAtual === "actual" && (isAdmin || (canPedidosCreate && isResponsavel))`.
   - A checagem de teto do front **permanece** (UX imediata) — o banco é a barreira, o front é a cortesia.
   - A auditoria inline de desvios Actual×Budget (bloco `projeto_pedido_auditoria` no handleSave) **permanece como está** — é outra tabela, outro propósito (desvio vs evento), não conflita.
3. **`Projetos.tsx`:** o `.upsert()` de edição de projeto e o `.delete()` — **manter por ora** (fora do escopo; funcionam para o fluxo atual). Registrado como P-1 na seção 6.
4. Build (Regra 4) → staging individual → push → conferir no editor Lovable → avisar o Pedro para Publish.

### L5 — Views de report (SQL, Pedro executa)
1. **`v_projeto_resumo`** — 1 linha por projeto: nome, fase, status, orçamento, `total_budget`, `total_actual`, `saldo_actual`, `pct_comprometido`, contagens de pedidos por status, `responsavel` (nome via profiles, join por `user_id`), `aprovador`, `budget_aprovado_por/em`, datas. Base do dashboard/Excel do controller.
2. **`v_projeto_eventos_report`** — eventos com nomes resolvidos (join profiles por `usuario_id = profiles.user_id`), pronto para filtrar por período/evento/projeto. Inclui os `teto_rejeitado` (quantas vezes tentaram estourar, quem, quanto).
3. RLS: views herdam das tabelas (security_invoker default) — conferir que o SELECT de `projeto_eventos` (L3.3) cobre.

### L6 — Validação fim-a-fim (operação real, evidências no diário)
Roteiro na ordem, com print/console de cada passo:
1. **Ana (não-admin):** edita um dos 5 pedidos do Actual → salva OK (o bug morre aqui).
2. Ana: cria pedido novo no Actual → OK; evento `pedido_criado` na tabela.
3. Ana: tenta salvar estourando o teto → toast com "Orçamento excedido: disponível R$ X"; evento `teto_rejeitado` gravado; nada persistido.
4. Ana: exclui um rascunho → OK + evento; tenta excluir um `enviado` (quando houver) → bloqueado com mensagem clara.
5. Ana: envia pedido ao Alvo → `numero_pedido_alvo` gravado via RPC; evento `pedido_enviado_alvo`.
6. **Fernando:** 1º login (senha temporária entregue fora de banda, troca forçada) → recebe e-mail de aprovação → aprova → pedidos copiam p/ Actual → evento `budget_aprovado`. (Pré-requisito: P-3.)
7. `v_projeto_resumo` e `v_projeto_eventos_report` refletem tudo; export de teste para Excel.
8. Regressão mínima: fluxo Budget de um projeto novo (criar projeto → pedidos budget → enviar aprovação) segue OK.

---

## 5. Riscos e rollback

| Risco | Mitigação |
|---|---|
| L3 fecha escrita antes de L2 funcionar → módulo morto | Ordem obrigatória L2→L3; L2.6 (dry-runs com JWT simulado) é gate de passagem |
| RPC editada perde SECURITY DEFINER (Regra 7) | Template do L2 já redeclara; verificação `prosecdef`+`proconfig` pós-apply |
| Policy "aplicada" que não persistiu (já ocorreu 07/08) | Regra 6: releitura de `pg_policies` é o único critério de concluído |
| Front novo contra banco velho (ou vice-versa) | L4 só após L3 verificado; janela de troca curta; se preciso, Pedro segura o Publish até o banco estar pronto (push sem Publish não afeta produção) |
| Sequência duplicada em criação concorrente | `FOR UPDATE` no projeto (L2.1.d) serializa |
| Rollback de banco | L0.1 é o snapshot; cada lote SQL entregue com bloco de reversão comentado no fim |
| Rollback de código | `git revert` do commit do L4 |

---

## 6. Pendências de decisão do Pedro

| # | Decisão | Status | Bloqueia |
|---|---|---|---|
| P-1 | Padronizar também o CRUD de `projetos` (Projetos.tsx) em RPC depois? | **ABERTA** | nada |
| P-2 | Notificar o Responsável por e-mail quando o Budget for aprovado (hoje ninguém avisa a Ana)? Se sim, Edge nova padrão estado+scan (molde PLANO-PEDIDOS) | **ABERTA** | nada |
| P-3 | Destravar Fernando: senha temporária via `hub-reset-user-password` + entrega fora de banda — **quando?** | **ABERTA** (operacional) | L6.6 |

---

## 7. Diagnóstico consolidado (sessões de 06–07/08 — contexto que NÃO se re-investiga)

- **Bug 42501 no Actual — causa-raiz confirmada:** `handleSave` usa `.upsert()`; no Postgres, upsert **sempre** avalia a WITH CHECK da policy de INSERT na linha proposta ("Row proposed for insertion is checked regardless of whether or not a conflict occurs" — doc oficial). A policy de INSERT exige `fase='budget'` dos dois lados → qualquer linha `fase='actual'` de não-admin é rejeitada, **mesmo na edição**. Budget salvava, Actual quebrava.
- **Policies vivas (medidas 07/08):** INSERT só-Budget · UPDATE já tem ramo Actual (`status in ('rascunho','erro') and bloqueado=false`) e passa para a Ana (`update_with_check_ok=true` com JWT simulado) · DELETE só-Budget · SELECT por `criado_por OR aprovador_id` (sem `responsavel_id` — divergência UI×RLS).
- **Incoerência já no código:** `enviar_budget_para_aprovacao` checa `criado_por` mas a mensagem diz "Apenas o responsável" — L2.4 corrige.
- **Padrões do Hub (levantamento do agente, 07/08):** gravação dominante moderna = RPC SECURITY DEFINER (OP 100%, Intercompany, Cartões); Suprimentos = upsert+onConflict (geração anterior); `.update()` inexistente no codebase (CORS bloqueia PATCH — documentado em `requisicoesService.ts:652` e regra geral). Titularidade dominante = permissão pura no RLS + escopo "own" no front; own no RLS só em Projetos e arquivos de Suprimentos. Validação de valor = só front em todo o Hub (**D-1 desta refatoração é exceção consciente**). Cartões: RPCs retornam a linha (`returns jsonb`) dispensando releitura — padrão adotado no L2.
- **Fluxo de aprovação verificado ponta-a-ponta:** RPC muda fase → front chama Edge `notify-aprovador-budget` (ACTIVE v14, Resend, whitelist ok) → e-mail ao `aprovador_email` (Fernando) com resumo financeiro + lista de pedidos + botão. Não-bloqueante (fase muda mesmo se e-mail falhar).
- **Fernando nunca logou:** `last_sign_in_at=null`, `email_confirmed_at` ok, `must_change_password=true`. `/reset-password` fora do ProtectedRoute (sem loop). Edge `hub-reset-user-password` existe (ACTIVE) — não envia e-mail; admin copia a senha e entrega fora de banda.
- **Dados do piloto:** "Congresso Rio Valves", orçamento 180k, Budget 100% comprometido, 5 pedidos copiados ao Actual (todos `rascunho`, `bloqueado=false`, `budget_origem_id` ok). Ana = criadora E responsável (por isso as policies antigas nunca a barraram no Budget).
- **Identidade:** joins de usuário SEMPRE por `profiles.user_id` (= auth.uid), **nunca** `profiles.id` (bug histórico FH47; Permissoes_v2 §2.4 documenta a pegadinha).

## 8. Diário

| Data | Item | Registro |
|---|---|---|
| 2026-08-07 | v2 criada | Plano de refatoração completo escrito a partir do diagnóstico das sessões 06–07/08 + levantamento de padrões do Hub. Decisões D-1..D-5 fechadas pelo Pedro. Nenhum lote executado. |
| 2026-08-07 | **L0 executado** (read-only) | **Pre-flight OK:** MCP ativo deste diretório = `https://mcp.supabase.com/mcp?project_ref=hbtggrbauguukewiknew&read_only=true&features=database` (`~/.claude.json:901-907`); fingerprint = `tabelas_modulo=3 · total_projetos=3 · total_pedidos=23` (critério de parada é `<>3` → passou; o plano previa `1\|10`, a operação andou). Baseline integral (policies, fonte das 4 funções, schema, índices) registrado na **seção 10**. **Nada contradiz a seção 7** — o diagnóstico do bug 42501 é confirmado linha a linha. **5 achados novos, 2 mexem no desenho do L2** (detalhe em 10.6): (A-1) `sequencia` **não é** max+1 por projeto — é `DEFAULT nextval('projeto_requisicoes_sequencia_seq')`, sequence **global**, **sem UNIQUE** — L2.1.i precisa de decisão do Pedro; (A-2) o pós-envio ao Alvo usa o **mesmo `.upsert()` da causa-raiz** → para não-admin o pedido entra no ERP e o status local não grava (divergência Hub×ERP latente) — eleva a prioridade do L2.5; (A-3) `responsavel_id` já preenchido = `criado_por` nos 3 projetos → virada de titularidade sem backfill; (A-4) `enviado_alvo_por` gravado como literal `"sistema"`; (A-5) os 2 projetos reais estão **exatamente no teto** — condiciona o roteiro do L6.1. |

## 9. Fora do escopo (não perder)

- **CRUD de `projetos` (a entidade) em Projetos.tsx** segue upsert/delete direto — padronizar em RPC é P-1.
- **Destravar login do Fernando** (P-3) — operacional, pré-requisito do L6.6; senha temporária + Teams.
- **E-mail ao Responsável na aprovação** (P-2) — hoje a Ana não é avisada quando o Fernando aprova.
- **Relatório gerencial PDF** (gerado 06/08) tem um ponto a corrigir numa v2: tratava as duas vias de admin como equivalentes; a Permissoes_v2 §9.1 mostra que o papel `admin` tem 42/55 permissões (defasado). Não urgente.
- **`profiles.is_admin` único (só Pedro)** — considerar segundo admin de contingência (bus factor).
- **Papel `admin` defasado (13 permissões órfãs)** — mapear as novas ao papel (checklist §8.7 da Permissoes_v2); não bloqueia Projetos.

---

## 10. Anexo L0 — Baseline medido em 07/08/2026 (read-only)

> Este é o **"antes"** do módulo: snapshot para rollback (Risco "Rollback de banco", seção 5) e fonte das funções que o L2 vai editar. **Não editar retroativamente** — se algo mudar no banco, novo anexo com nova data.

### 10.1 Pre-flight (seção 0.5)
- MCP ativo para `C:/Users/PFBR-2601-3/finances-pf` (`~/.claude.json:901-907`): `https://mcp.supabase.com/mcp?project_ref=hbtggrbauguukewiknew&read_only=true&features=database` ✅ (há outra entrada no mesmo arquivo apontando para `project_ref=xmmwhvwoufatxdnwydel`, de **outro** diretório de trabalho — não é a ativa aqui).
- Fingerprint: `tabelas_modulo=3` · `total_projetos=3` · `total_pedidos=23` ✅.

### 10.2 `pg_policies` — snapshot integral das 3 tabelas
Todas `PERMISSIVE`, role `{authenticated}`.

**`projetos`** (4 policies)
```sql
projetos_select  SELECT  USING (_is_admin() OR _user_has_perm('projetos.view_all')
                                OR (_user_has_perm('projetos.view_own')
                                    AND (criado_por = auth.uid() OR aprovador_id = auth.uid())))
projetos_insert  INSERT  WITH CHECK ((_is_admin() OR _user_has_perm('projetos.create'))
                                     AND criado_por = auth.uid())
projetos_update  UPDATE  USING (_is_admin()
                                OR (_user_has_perm('projetos.edit_own') AND criado_por = auth.uid()
                                    AND fase_atual = 'budget')
                                OR (_user_has_perm('projetos.approve') AND aprovador_id = auth.uid()
                                    AND fase_atual = 'budget_em_aprovacao'))
                 WITH CHECK (_is_admin()
                             OR (_user_has_perm('projetos.edit_own') AND criado_por = auth.uid())
                             OR (_user_has_perm('projetos.approve') AND aprovador_id = auth.uid()))
projetos_delete  DELETE  USING (_is_admin()
                                OR (_user_has_perm('projetos.delete_own') AND criado_por = auth.uid()
                                    AND fase_atual = 'budget'))
```

**`projeto_requisicoes`** (4 policies)
```sql
projeto_requisicoes_select  SELECT  USING (EXISTS (SELECT 1 FROM projetos pr
  WHERE pr.id = projeto_requisicoes.projeto_id
    AND (_is_admin() OR _user_has_perm('projetos.view_all')
         OR (_user_has_perm('projetos.view_own')
             AND (pr.criado_por = auth.uid() OR pr.aprovador_id = auth.uid())))))

projeto_requisicoes_insert  INSERT  WITH CHECK (_is_admin() OR (
  _user_has_perm('projetos.pedidos.create') AND EXISTS (SELECT 1 FROM projetos pr
    WHERE pr.id = projeto_requisicoes.projeto_id
      AND pr.criado_por = auth.uid()
      AND pr.fase_atual = 'budget'
      AND projeto_requisicoes.fase = 'budget')))          -- ← só-Budget: causa do 42501

projeto_requisicoes_update  UPDATE  USING (_is_admin() OR (EXISTS (SELECT 1 FROM projetos pr
    WHERE pr.id = projeto_requisicoes.projeto_id
      AND pr.criado_por = auth.uid()
      AND _user_has_perm('projetos.pedidos.create')
      AND ((pr.fase_atual = 'budget' AND projeto_requisicoes.fase = 'budget')
        OR (pr.fase_atual = 'actual' AND projeto_requisicoes.fase = 'actual'
            AND projeto_requisicoes.status = ANY (ARRAY['rascunho','erro'])
            AND projeto_requisicoes.bloqueado = false)))))
                            WITH CHECK (_is_admin() OR (EXISTS (SELECT 1 FROM projetos pr
    WHERE pr.id = projeto_requisicoes.projeto_id
      AND pr.criado_por = auth.uid()
      AND _user_has_perm('projetos.pedidos.create'))))

projeto_requisicoes_delete  DELETE  USING (_is_admin() OR (EXISTS (SELECT 1 FROM projetos pr
    WHERE pr.id = projeto_requisicoes.projeto_id
      AND pr.criado_por = auth.uid()
      AND _user_has_perm('projetos.pedidos.create')
      AND pr.fase_atual = 'budget'
      AND projeto_requisicoes.fase = 'budget')))
```

**`projeto_pedido_auditoria`** (2 policies — **sem UPDATE e sem DELETE: append-only na prática**; é o molde direto para `projeto_eventos` do L1)
```sql
projeto_pedido_auditoria_select  SELECT  USING (EXISTS (SELECT 1 FROM projetos pr
  WHERE pr.id = projeto_pedido_auditoria.projeto_id
    AND (_is_admin() OR _user_has_perm('projetos.view_all')
         OR (_user_has_perm('projetos.view_own')
             AND (pr.criado_por = auth.uid() OR pr.aprovador_id = auth.uid())))))
projeto_pedido_auditoria_insert  INSERT  WITH CHECK (EXISTS (SELECT 1 FROM projetos pr
  WHERE pr.id = projeto_pedido_auditoria.projeto_id
    AND (_is_admin() OR pr.criado_por = auth.uid() OR pr.aprovador_id = auth.uid())))
```

### 10.3 Funções — metadados e fonte
| Função | Assinatura | Retorno | `prosecdef` | `proconfig` | volatile | tamanho | md5 do `functiondef` |
|---|---|---|---|---|---|---|---|
| `_is_admin` | *(sem args)* | boolean | ✅ true | `search_path=public, auth` | STABLE (sql) | 274 | `820b514a65fec38c6c55cb38b1897dcb` |
| `_user_has_perm` | `p_codigo text` | boolean | ✅ true | `search_path=public, auth` | STABLE (sql) | 535 | `8f80ddfb33464ee7181429406ac63e47` |
| `enviar_budget_para_aprovacao` | `p_projeto_id uuid` | jsonb | ✅ true | `search_path=public, auth` | VOLATILE (plpgsql) | 3101 | `afc3f2dc30f4492b54c6013d19d31a54` |
| `aprovar_budget_projeto` | `p_projeto_id uuid` | jsonb | ✅ true | `search_path=public, auth` | VOLATILE (plpgsql) | 3579 | `eb594b06c9d593a7597dd72c4ce3de15` |

> Regra 7 vale para as quatro: `CREATE OR REPLACE` **precisa redeclarar** `SECURITY DEFINER` + `SET search_path = public, auth`.

**Helpers (o L2 replica o gate destes):**
```sql
CREATE OR REPLACE FUNCTION public._is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE user_id = auth.uid()),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public._user_has_perm(p_codigo text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    public._is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.hub_user_roles ur
      JOIN public.hub_role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.hub_permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.revogado_em IS NULL
        AND p.codigo = p_codigo
    );
$function$;
```
> Nota: `_user_has_perm` **já embute** `_is_admin()` — no gate das RPCs do L2, `_user_has_perm('x')` sozinho basta para o Pedro passar; o `_is_admin()` explícito continua necessário só onde a regra difere para admin (D-2, D-3).

**`enviar_budget_para_aprovacao` — fonte capturado (o L2.4 parte daqui):**
```sql
CREATE OR REPLACE FUNCTION public.enviar_budget_para_aprovacao(p_projeto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_projeto record;
  v_uid uuid := auth.uid();
  v_is_admin boolean := public._is_admin();
  v_total_budget numeric;
  v_count_budget int;
  v_aprovador_email text;
  v_aprovador_nome text;
  v_responsavel_email text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- Lock pessimista: bloqueia o projeto pra evitar race condition
  -- (dois cliques simultâneos em "Enviar para Aprovação")
  SELECT * INTO v_projeto FROM public.projetos WHERE id = p_projeto_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Autorização: criador OR admin
  IF NOT v_is_admin AND v_projeto.criado_por <> v_uid THEN     -- ← L2.4 troca por responsavel_id
    RAISE EXCEPTION 'Apenas o responsável do projeto ou um administrador pode enviar para aprovação'
      USING ERRCODE = '42501';
  END IF;

  -- Validação de fase
  IF v_projeto.fase_atual <> 'budget' THEN
    RAISE EXCEPTION 'Projeto não está em fase Budget (fase atual: %)', v_projeto.fase_atual
      USING ERRCODE = '22023';
  END IF;

  -- Validação: aprovador definido
  IF v_projeto.aprovador_id IS NULL THEN
    RAISE EXCEPTION 'Aprovador não foi definido para este projeto. Edite o projeto e defina um aprovador antes de enviar para aprovação.'
      USING ERRCODE = '22023';
  END IF;

  -- Validação: pelo menos 1 pedido em Budget
  SELECT count(*), COALESCE(sum(valor_total), 0)
    INTO v_count_budget, v_total_budget
    FROM public.projeto_requisicoes
   WHERE projeto_id = p_projeto_id AND fase = 'budget';

  IF v_count_budget = 0 THEN
    RAISE EXCEPTION 'Adicione pelo menos 1 pedido de compra em Budget antes de enviar para aprovação'
      USING ERRCODE = '22023';
  END IF;

  -- UPDATE atômico
  UPDATE public.projetos
     SET fase_atual = 'budget_em_aprovacao',
         status = 'pendente_aprovacao',
         enviado_para_aprovacao_em = now(),
         enviado_para_aprovacao_por = v_uid,
         updated_at = now()
   WHERE id = p_projeto_id;

  -- Busca metadados pro frontend disparar o email
  SELECT p.email, COALESCE(p.full_name, p.email)
    INTO v_aprovador_email, v_aprovador_nome
    FROM public.profiles p WHERE p.user_id = v_projeto.aprovador_id;

  SELECT p.email INTO v_responsavel_email
    FROM public.profiles p WHERE p.user_id = v_projeto.criado_por;

  RETURN jsonb_build_object(
    'success', true,
    'projeto_id', p_projeto_id,
    'projeto_nome', v_projeto.nome,
    'aprovador_id', v_projeto.aprovador_id,
    'aprovador_email', v_aprovador_email,
    'aprovador_nome', v_aprovador_nome,
    'responsavel_email', v_responsavel_email,
    'total_budget', v_total_budget,
    'orcamento', v_projeto.orcamento,
    'count_pedidos', v_count_budget,
    'enviado_em', now()
  );
END;
$function$;
```
> **Confirma o diagnóstico da seção 7:** o gate é `criado_por`, a mensagem promete "responsável". Também confirma que o teto **não** é validado aqui — `total_budget` e `orcamento` só viajam no retorno (base do D-1).

**`aprovar_budget_projeto` — fonte capturado:**
```sql
CREATE OR REPLACE FUNCTION public.aprovar_budget_projeto(p_projeto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_projeto record;
  v_uid uuid := auth.uid();
  v_is_admin boolean := public._is_admin();
  v_aprovador_email text;
  v_count_actual_existente int;
  v_count_actual_final int;
  v_total_actual numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  -- Lock pessimista contra duplo clique
  SELECT * INTO v_projeto FROM public.projetos WHERE id = p_projeto_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projeto não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Autorização: aprovador designado OR admin
  IF NOT v_is_admin AND v_projeto.aprovador_id <> v_uid THEN
    RAISE EXCEPTION 'Apenas o aprovador designado ou um administrador pode aprovar este projeto'
      USING ERRCODE = '42501';
  END IF;

  -- Validação de fase
  IF v_projeto.fase_atual <> 'budget_em_aprovacao' THEN
    RAISE EXCEPTION 'Projeto não está aguardando aprovação (fase atual: %). Use enviar_budget_para_aprovacao primeiro.', v_projeto.fase_atual
      USING ERRCODE = '22023';
  END IF;

  -- Email do aprovador
  SELECT email INTO v_aprovador_email FROM public.profiles WHERE user_id = v_uid;

  -- Idempotência: se já existem pedidos Actual neste projeto, não duplicar
  SELECT count(*) INTO v_count_actual_existente
    FROM public.projeto_requisicoes
   WHERE projeto_id = p_projeto_id AND fase = 'actual';

  IF v_count_actual_existente = 0 THEN
    -- Copia Budget → Actual
    INSERT INTO public.projeto_requisicoes (
      projeto_id, fase, budget_origem_id, sequencia, descricao,
      fornecedor_codigo, fornecedor_nome, fornecedor_cnpj,
      cond_pagamento_codigo, cond_pagamento_nome,
      itens, classe_rateio, valor_total,
      status, bloqueado, criado_por, created_at, updated_at
    )
    SELECT
      projeto_id, 'actual' AS fase, id AS budget_origem_id, sequencia, descricao,
      fornecedor_codigo, fornecedor_nome, fornecedor_cnpj,
      cond_pagamento_codigo, cond_pagamento_nome,
      itens, classe_rateio, valor_total,
      'rascunho' AS status, false AS bloqueado, criado_por, now(), now()
    FROM public.projeto_requisicoes
    WHERE projeto_id = p_projeto_id AND fase = 'budget';
  END IF;

  -- UPDATE projeto: agora é Actual e está aprovado
  UPDATE public.projetos
     SET fase_atual = 'actual', status = 'aprovado',
         budget_aprovado_por = v_aprovador_email,
         budget_aprovado_em = now(), updated_at = now()
   WHERE id = p_projeto_id;

  SELECT count(*), COALESCE(sum(valor_total), 0)
    INTO v_count_actual_final, v_total_actual
    FROM public.projeto_requisicoes
   WHERE projeto_id = p_projeto_id AND fase = 'actual';

  RETURN jsonb_build_object(
    'success', true, 'projeto_id', p_projeto_id, 'projeto_nome', v_projeto.nome,
    'copiados', v_count_actual_final, 'ja_existiam', v_count_actual_existente,
    'novos_nesta_chamada', v_count_actual_final - v_count_actual_existente,
    'total_actual', v_total_actual, 'aprovado_por', v_aprovador_email, 'aprovado_em', now()
  );
END;
$function$;
```
> Responde a pergunta aberta do **L3.2**: sim, `aprovar_budget_projeto` faz o `UPDATE public.projetos` por dentro (SECURITY DEFINER) → o ramo do aprovador na policy de UPDATE de `projetos` **pode sair** sem quebrar a aprovação. Gate já é `aprovador_id = auth.uid()` — mas **sem** `_user_has_perm('projetos.approve')` (a policy exige, a RPC não). Ponto para o L2.4.

### 10.4 Schema real
**`projetos`** (18 colunas; `attnum` 6 vago = coluna dropada no passado)
`id` uuid PK · `nome` text NN · `descricao` text · `orcamento` numeric NN d:0 · `status` text NN d:'pendente' · `data_inicio` date · `data_fim` date · `criado_por` uuid · `created_at`/`updated_at` timestamptz d:now() · `fase_atual` text NN d:'budget' · `budget_aprovado_por` **text** · `budget_aprovado_em` timestamptz · `aprovador_id` uuid · `enviado_para_aprovacao_em` timestamptz · `enviado_para_aprovacao_por` uuid · `email_aprovacao_enviado_em` timestamptz ✅ · **`responsavel_id` uuid NOT NULL**

CHECKs e FKs:
```sql
projetos_fase_atual_check  CHECK (fase_atual = ANY (ARRAY['budget','budget_em_aprovacao','actual']))
projetos_status_check      CHECK (status = ANY (ARRAY['pendente','pendente_aprovacao','aprovado','concluido','cancelado']))
FK aprovador_id                 → auth.users(id) ON DELETE SET NULL
FK enviado_para_aprovacao_por   → auth.users(id) ON DELETE SET NULL
FK responsavel_id               → auth.users(id) ON DELETE SET NULL   -- ⚠️ coluna é NOT NULL
índices: idx_projetos_responsavel_id · idx_projetos_criado_por (parcial) · idx_projetos_aprovador_id (parcial)
```
`criado_por` **não tem FK** (só índice parcial).

**`projeto_requisicoes`** (24 colunas — idêntico ao mapeado em 07/08, **nada mudou**)
`id` uuid PK · `projeto_id` uuid NN · **`sequencia` int NN d:`nextval('projeto_requisicoes_sequencia_seq')`** · `descricao` text NN · `fornecedor_codigo/nome/cnpj` text · `cond_pagamento_codigo/nome` text · `itens` jsonb d:'[]' · `classe_rateio` jsonb d:'[]' · `valor_total` numeric NN d:0 · `status` text NN d:'rascunho' · `numero_pedido_alvo` text · `erro_envio` text · `enviado_em` timestamptz · `criado_por` uuid · `created_at`/`updated_at` timestamptz d:now() · `fase` text NN d:'budget' · `budget_origem_id` uuid · `bloqueado` bool NN d:false · `enviado_alvo_em` timestamptz · `enviado_alvo_por` **text**

Constraints: **só** `PRIMARY KEY (id)` + `FK projeto_id → projetos(id) ON DELETE CASCADE`.
**Não existe UNIQUE** `(projeto_id, sequencia, fase)` nem qualquer outro. **Não existe CHECK** em `status` nem em `fase` (texto livre). Único índice: a PK. **Sem trigger** (nem `updated_at` — quem grava é o app).

**`projeto_pedido_auditoria`** (11 colunas): `id` · `projeto_id` · `requisicao_id` · `budget_origem_id` · `campo` NN · `valor_budget`/`valor_actual` text · `desvio_valor`/`desvio_percentual` numeric · `usuario` **text (e-mail, não uuid)** · `created_at`. Só PK; sem FK.

### 10.5 Dados do piloto (07/08, pós-fingerprint)
| Projeto | fase_atual | status | orçamento | Budget (qtd/total/seq) | Actual (qtd/total/seq) |
|---|---|---|---|---|---|
| Congresso Rio Valves | actual | aprovado | 180.000 | 5 · 180.000 · #24-35 | 5 · 180.000 · #24-35 |
| Congresso Caipira Rio Preto | actual | aprovado | 50.000 | 5 · 50.000 · #44-48 | 5 · 50.000 · #44-48 |
| teste | actual | aprovado | 10.000 | 2 · 1.100 · #38-39 | 1 · 1.000 · #43 |

- Nos 3 projetos: `criado_por = responsavel_id` (Ana `e96876e1…` nos dois reais; Pedro `0b52e262…` no "teste"). `aprovador_id` = Fernando `41b07a68…` nos reais.
- `projeto_requisicoes_sequencia_seq.last_value = 59` (global, já além do maior `sequencia` em uso).
- No "teste", o Actual (#43) **não** veio da cópia (Budget é #38-39): foi criado direto no Actual — hoje só admin consegue, e o Pedro é admin. É a única linha `status='enviado'`/`bloqueado=true` do módulo.

### 10.6 Achados do L0 (o que muda, o que confirma)
**Confirma a seção 7 integralmente** — INSERT só-Budget, UPDATE com ramo Actual, DELETE só-Budget, SELECT por `criado_por OR aprovador_id`, gate `criado_por` com mensagem "responsável". Nenhuma contradição.

| # | Achado | Impacto |
|---|---|---|
| A-1 | **`sequencia` é `nextval` de sequence GLOBAL**, não max+1 por projeto; **não há UNIQUE**; o front **nunca** atribui (só lê: `ProjetoRequisicoes.tsx:179` ordena, `:668`/`:848` exibem); `aprovar_budget_projeto` **copia** a sequencia do Budget para o Actual (pares compartilham o número). | **L2.1.i pressupunha max+1 por projeto** → precisa de decisão do Pedro antes de escrever a RPC. Manter o DEFAULT = zero risco e preserva os números atuais; mudar para max+1 renumeraria (ex.: Rio Valves #24-35 → #36 no próximo) e criaria dois regimes na mesma tabela. |
| A-2 | O **pós-envio ao Alvo** (`alvoProjetoPedidoService.ts:355` e `:387`) grava via `.upsert()` — **a mesma construção da causa-raiz**. Para não-admin em `fase='actual'`, a WITH CHECK do INSERT rejeita: o pedido **entra no ERP** e o Hub **não** registra `numero_pedido_alvo`/`status='enviado'`. A função retorna `success: true` com aviso em `error`, e o `catch` que gravaria `status='erro'` falha pelo mesmo motivo. | Divergência **Hub × ERP** latente e silenciosa. Eleva o **L2.5** de "migrar por padrão" a **correção de bug**. Hoje só não estourou porque quem enviou foi o Pedro (admin). |
| A-3 | `projetos.responsavel_id` é **NOT NULL** e **já está preenchido = `criado_por`** nos 3 projetos; tem índice próprio. | A virada de titularidade (`criado_por` → `responsavel_id`) do L2/L3 é **segura e sem backfill**, e não muda o comportamento de ninguém hoje. Ponto de atenção: a FK é `ON DELETE SET NULL` numa coluna NOT NULL — deletar um usuário responsável quebraria com erro em vez de limpar. Registrar, não corrigir agora. |
| A-4 | `enviado_alvo_por` é gravado como **literal `"sistema"`** (é `text`, não uuid) — não registra quem enviou. | O L2.5 pode gravar o usuário real; decisão do Pedro (o plano diz "cobrir 1:1"). |
| A-5 | Rio Valves e Caipira estão com Actual **exatamente no teto** (180k/180k e 50k/50k). | Com D-1 ativo, edição que **aumente** valor será rejeitada — correto por desenho, mas o roteiro do **L6.1** (Ana edita e salva OK) só passa se o valor não subir. Vale ter um pedido com folga para o teste, ou testar com valor igual/menor. |
| A-6 | `projeto_pedido_auditoria` tem **só SELECT e INSERT** (append-only) e `usuario` é **text/e-mail**. | Molde confirmado para `projeto_eventos` (L1) — mas o plano define `usuario_id uuid` + `usuario_email`: melhor, mantém. |

### 10.7 Pós-envio ao Alvo — mapa 1:1 para o L2.5
`enviarRequisicaoAlvo(requisicaoId, projetoNome)` em `src/services/alvoProjetoPedidoService.ts`. Gates pré-POST que **permanecem no front** (P7, linhas 26-75): pedido `fase='actual'`, projeto `fase_atual='actual'` **e** `status='aprovado'`, guard de duplicidade (`status='enviado' AND numero_pedido_alvo`), `validar()` (fornecedor, cond. pagamento, itens com código e valor, rateio somando 100 ±0.01).

**Sucesso** (`:355-365`) — `.upsert({...reqAtual, …})` grava:
| Campo | Valor |
|---|---|
| `status` | `'enviado'` |
| `numero_pedido_alvo` | `result.Numero \|\| result.numero \|\| result.NumeroPedComp \|\| null` |
| `enviado_em` | `now()` (ISO do browser) |
| `erro_envio` | `null` |
| `bloqueado` | `true` |
| `enviado_alvo_em` | `now()` (ISO do browser) |
| `enviado_alvo_por` | `'sistema'` (literal) |
| `updated_at` | `now()` (ISO do browser) |

**Falha** (`:387-392`) — `.upsert({...reqErr, …})` grava: `status='erro'` · `erro_envio = msg` · `updated_at`. **Não** limpa `numero_pedido_alvo` nem mexe em `bloqueado`.

→ `projeto_pedido_marcar_enviado(p_id, p_numero_alvo, p_sucesso, p_erro)` do L2.5 precisa cobrir exatamente esses dois conjuntos (timestamps passando a `now()` do banco), mais o evento `pedido_enviado_alvo`.
