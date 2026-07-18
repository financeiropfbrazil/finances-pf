# PLANO-PEDIDOS.md — Módulo Suprimentos (Requisições e Pedidos) — v3

> **Documento vivo.** Claude Code: leia no início de toda sessão de Suprimentos; atualize status (seção 2) e diário (seção 8) ao concluir cada item. **Nunca alterar item registrado** — mudanças viram itens novos (Ajuste/Correção). Sessão FH46. v3 de 17/07/2026 (v1 prompts, v2 lotes — histórico no diário). Pré-diagnóstico completo: código lido (cron, notify, pedidosService, erp-proxy pedComp/client/auth, InventoryImport, alvoEstoqueService) + censo de status Hub×Alvo.

---

## 0. Regras
1. Um lote por vez; **problema → causa → impacto → solução → risco** antes de executar; aprovação do Pedro em todo ponto de escrita.
2. Staging individual (`git add <arquivo>`), proibido `git add -A`; `git status` antes de commit (working tree compartilhado com outras sessões).
3. Build limpo (`bun run build`, TS estrito) antes de push. Push = preview; app publicado exige Publish manual no Lovable.
4. Edge Functions: deploy SEMPRE via CLI com `--project-ref hbtggrbauguukewiknew`; confirmar que a função responde após deploy (deploy fantasma já ocorreu). Deploys que afetam sync: fora das janelas do cron ou com kill-switch `sync_settings`.
5. **Migration antes de query de teste** (causa nº 1 de falso "does not exist"). Nunca assumir schema — ler antes de escrever.
6. erp-proxy: repo separado, edição via GitHub Web (clone local sempre stale), Render auto-deploy na main. Nunca misturar mudanças dos dois repos numa tarefa.

## 0.5. Pre-flight Supabase (obrigatório antes de qualquer query/deploy)
Projeto: **`hbtggrbauguukewiknew`** (`https://hbtggrbauguukewiknew.supabase.co`). Pedro tem OUTROS projetos Supabase — verificar por evidência:
1. URL do MCP contém `project_ref=hbtggrbauguukewiknew` e `read_only=true`; divergiu → PARE.
2. Fingerprint (primeira query da sessão): `select (select count(*) from information_schema.tables where table_schema='public' and table_name in ('compras_pedidos','compras_requisicoes','compras_pedidos_emails_log')) as tabelas_modulo, (select count(*) from compras_pedidos) as total_pedidos;` → esperado 3 e ~1.650+. Diferente = banco errado, PARE.
3. CLI sempre com `--project-ref` explícito. 4. Registrar no diário que passou.

---

## 1. MAPA DE STATUS OFICIAL (censo 17/07 — Hub e Alvo batem, 16 combinações)

Eixos observados — **vocabulário completo**, validado nas duas fontes:
- `Status`: Aberto, Pendente, Encerrado, Cancelado, Cancelado Parcial, Reavaliar, null (só rascunhos do Hub)
- `Aprovado`: Total, Não (Parcial nunca ocorreu) · `StatusAprovacao`: Nenhum, Em Andamento, Reavaliar, Finalizada · `Comprado`: Sim, Não

**Status efetivo (único, derivado — `statusPedido.ts` + CASE SQL espelhado, primeira regra que casar vence):**
| # | Status efetivo | Regra |
|---|---|---|
| 1 | Rascunho | `status_local='rascunho'` |
| 2 | Erro no envio | `status_local='erro_envio'` |
| 3 | Excluído no Alvo | `status_local='excluido_alvo'` (404 no Load — **pendente L3**, só com cross-check; ver L3 item 4) |
| 4 | Cancelado | `status='Cancelado'` |
| 5 | Cancelado Parcial | `status='Cancelado Parcial'` |
| 6 | Concluído | `status='Encerrado'` |
| 7 | Em aprovação | `status_aprovacao='Em Andamento'` |
| 8 | Reavaliar | `status='Reavaliar'` OU `status_aprovacao='Reavaliar'` |
| 9 | Comprado — em andamento | `aprovado='Total'` e `comprado='Sim'` |
| 10 | Aprovado — aguardando compra | `aprovado='Total'` e `comprado='Não'` |
| 11 | Aguardando envio p/ aprovação | `aprovado='Não'` e `status_aprovacao='Nenhum'` |

Filtro do dropdown = essa lista (Enviando fica como estado transitório do card; "Enviado ao ERP"/"Sincronizado" saem — cobertos pelo filtro Origem). Cancelado prevalece sobre aprovação (`Cancelado|Total|Finalizada|Sim` exibe Cancelado). Censo de referência: Encerrado 1.159 no Hub / 1.243 no Alvo (defasagem ~150 = Frente B quantificada); ~90 pedidos ausentes do Hub (buracos de descoberta). Os 7 `status NULL` são `RASCUNHO-*` (não vítimas de wipe — confirmar no L1.0).

**Gatilhos de e-mail (Resend `notificapfbr.com.br`, verificado sa-east-1):**
- **Criador (role Operador de Compras):** pedido 100% aprovado = `aprovado='Total' AND status_aprovacao='Finalizada'`.
- **Requisitante:** pedido Concluído = `status='Encerrado'` (guarda contra as 5 anomalias legadas `Encerrado|Não|Nenhum`: exigir também `aprovado='Total'` — ver P-5).

---

## 2. Lotes (registro imutável)

| Lote | Conteúdo | Repo | Status |
|---|---|---|---|
| L0 | Herança FH41 + verificações de schema do L1 | SQL/MCP | ⬜ |
| L1 | Cron de status: anti-wipe, filtro/count, persistir itens (404→excluido_alvo **movido p/ L3**) | finances-pf (Edge) | ✅ **parcial** — 1/3/4 em produção, smoke OK 17/07; Correção 2 relocada ao L3 |
| L3 | erp-proxy: 502 no Load sem Numero; ler contrato produto-sync e sync de entidades | erp-proxy | ⬜ |
| L2 | E-mails estado+scan: gate secret no criador; requisitante→Concluído (novo scan + neutralização) | finances-pf (Edge) | ⬜ |
| L4 | Frontend: statusPedido.ts+filtro+badges; open-load ped/req; botão Atualizar Cadastros; .range() combobox | finances-pf (src) | ⬜ |
| LD | Edge sync-cadastros-delta (produtos + entidades) reutilizando RPC existente | finances-pf (Edge) | ⬜ |
| L5 | Data-fix: backfill de itens órfãos (0004441 etc.); recuperação de wipados SE existirem | SQL/disparo manual | ⬜ |
| L6 | Validação fim-a-fim com operação real | — | ⬜ |

Ordem: **L0 → L1 → L3 → L2 → LD → L4 → L5 → L6** (L4 consome statusPedido + delta + open-load de uma vez).

---

## 3. Detalhe dos lotes

### L0 — Herança FH41 + verificações (read-only/SQL operador)
1. `SYNC_TEST.md` no repo? Ryan `profiles.alvo_usuario` null? Backfill `codigo_usuario` (preview→UPDATE mão do operador).
2. **Verificações que o L1 precisa:** (a) os 7 `status IS NULL` são todos `status_local='rascunho'`/`RASCUNHO-*`? (b) chave única de `compras_pedidos_itens` (existe unique `pedido_id+sequencia`? senão, migration antes); (c) `compras_pedidos_auditoria`: existem eventos `sync_status` com `status_novo IS NULL` (wipes reais)? Esperado: zero — se houver, ativa L5.2; (d) `cron.job`: jobid/schedule reais do `sync-compras-status-cron` (Pedro: ~1x/hora) e dos crons de produtos/entidades (Pedro: ~1x/dia); (e) constraint/enum de `status_local` comporta `'excluido_alvo'`? senão, migration.

### L1 — `sync-compras-status-cron` (um arquivo, um deploy)
1. **Anti-wipe (prevenção):** Job 2 — Load sem objeto com `Numero` → pula, loga `payload_invalido` em `detalhes`, conta erro. Nunca upsert de resposta vazia. (Mesma guarda leve no Job 1/reqs se aplicável.)
2. **404 → fora da fila:** `status_local='excluido_alvo'` + `synced_at` carimbado + auditoria `evento='excluido_alvo'`. NÃO tocar status/aprovado (preserva último estado). Filtro passa a excluir `excluido_alvo`.
3. **Filtro de candidatos:** excluir explicitamente `status_local in ('rascunho','erro_envio','excluido_alvo')` (rascunho não existe no Alvo — NÃO incluir status NULL na varredura); aspas duplas em `in.("Em Andamento","Reavaliar")`; validar a query REST antes/depois (contagem vs SELECT SQL).
4. **Persistir itens:** quando `detalhes_carregados=false`, gravar `ItemPedCompChildList` em `compras_pedidos_itens` (upsert na chave confirmada no L0; itens `Cancelado='Sim'`: decidir gravar-marcado vs pular olhando o schema) e virar a flag. Zero chamadas extras — o detalhe já está na mão.
5. Smoke: disparo `manual_admin`, conferir `sync_runs` + amostra de pedidos; rollback = redeploy da versão anterior (guardar cópia antes).

### L3 — erp-proxy (GitHub Web)
1. `GET /ped-comp/:filial/:numero`: `result.ok` mas `data` sem `Numero` → **502** `Resposta inválida do Alvo` (nunca 200-null). Mesmo padrão no análogo de req se existir.
2. **Ler e registrar (seção 7):** rota `/estoque/produto-sync` — endpoint Alvo por baixo, ordenação, aceita filtro por `DataCadastro`? E localizar a rota do **sync de entidades** (separado, contrato desconhecido) + tabela-espelho no Hub. Decide a estratégia do LD (filtro por data preferida; fallback: paginação decrescente por código).
3. Deploy fora das janelas de cron.
4. **404→`excluido_alvo` — RELOCADO do L1 (ver diário 17/07 "L1 ROLLBACK").** A Correção 2 do L1 marcava excluído em qualquer 404 do Load — no smoke marcou **7 pedidos vivos** (6/7 eram 404 crônico; 0004441 estava na lista do Alvo e fora descoberto no dia anterior). **O 404 do proxy NÃO é sinal confiável de exclusão** (L3.1). **REGRA para reintroduzir:** só marcar `excluido_alvo` com **CROSS-CHECK**, nunca por um único 404 — exige **(a)** 404 confiável no Load (só após o L3.1: proxy retorna 502 em payload inválido e 404 apenas para not-found genuíno) **E (b)** ausência do pedido na lista `/ped-comp/list` na janela do pedido. Um 404 isolado COM presença na lista = **404 falso → no-op**. A guarda anti-wipe (L1.1, já em produção) cobre o 200-null; esta regra cobre o 404-falso. Só depois disso o filtro de candidatos volta a excluir `status_local='excluido_alvo'`.

### L2 — E-mails, arquitetura ESTADO+SCAN (P-1)
Filosofia: e-mail não nasce de transição detectada (o open-load do L4 mataria as transições) e sim de **estado + dedup**: scan periódico pergunta "existe pedido neste estado sem este e-mail no log?". Vale para os dois e-mails; quem atualizou o status (cron, open-load, data-fix) é irrelevante.
1. **`notify-pedido-criador`:** gate de `CRON_SECRET` (padrão do sync; preservar scan/single/force_test) + atualizar chamada do cron jobid 21. Elegibilidade inalterada. Fecha a exposição pública do `override_email`.
2. **Requisitante → Concluído:** scan novo (na mesma função ou irmã), elegibilidade `status='Encerrado' AND aprovado='Total'` + resolução do requisitante (via req vinculada), `tipo='pedido_concluido'`, template "seu pedido foi concluído". **Neutralização ANTES do go-live:** `backlog-neutralizado` para os ~1.150+ já-encerrados (dry-run com contagem; P-3).
3. **Remover** o disparo inline `aprovouAgora` → `notify-pedido-aprovado` no Job 2 (deploy coordenado com L1 ou subsequente; o requisitante deixa de ser notificado na aprovação — decisão do Pedro 17/07).
4. Smoke com `force_test`/`override_email` para o Pedro; validação real no L6.

### LD — Edge `sync-cadastros-delta`
Objetivo: operadora cadastra produto/entidade no Alvo → botão no Hub importa **só os recém-criados** (segundos), sem rodar o sync completo (que continua dono de updates/desativações, cron diário).
1. Auth: JWT do usuário + checagem de role Operador de Compras (P-4) no servidor.
2. Produtos: buscar recentes via gateway (estratégia definida no L3.2 — `DataCadastro >= hoje-3d` preferida; idempotente), mapear no MESMO shape do sync atual e **reutilizar a RPC `sync_stock_products_from_erp`** (preserva codigo_alternativo/unidade; lotes 200). Entidades: mesmo padrão com o contrato do L3.2.
3. `sync_runs` com `job_type='cadastros_delta'` — NUNCA `'produtos'` (não pode mascarar o "Atualizado em" da tela de Estoques, que filtra por esse job_type).
4. Resposta à UI: placar `{produtos_novos, entidades_novas}`; cooldown ~60s.

### L4 — Frontend
1. **`statusPedido.ts`** (irmão do `statusRequisicao.ts`) com o mapa da seção 1 + CASE SQL espelhado (view/coluna) para filtro server-side; badge, filtro e dashboard consomem a MESMA função. Dropdown = lista da seção 1.
2. **Open-load:** ao abrir detalhe de Pedido OU Requisição, UM Load automático via gateway com Loading; atualiza status/valores/vínculo, persiste itens se ausentes (upsert `onConflict`; nunca `.update()` — CORS bloqueia PATCH), 404 → marca `excluido_alvo` e exibe. Guarda anti-duplo-fetch por open; falha do gateway = aviso visível + dados locais. Sem lógica de e-mail no frontend (estado+scan cobre).
3. **Badges** Cancelado / Cancelado Parcial / Excluído no Alvo distintos.
4. **Botão "Atualizar cadastros"** (produtos+entidades) no fluxo das operadoras (wizard de pedido e/ou Suprimentos), gate role Operador de Compras, chama LD, mostra placar/erro.
5. **ProductCombobox:** paginação `.range()` em lotes de 1000 (copiar o padrão do `fetchProducts` da InventoryImport). Sem isso, produto importado pelo delta pode não aparecer — pareceria bug do botão.
6. Build limpo; Publish manual ao final.

### L5 — Data-fix (dry-run + mão do operador)
1. Backfill de itens dos pedidos órfãos: com L1.4 no ar, disparos `manual_admin` drenam (LIMIT 100/ciclo); medir antes/depois; 0004441 como caso-teste. Reqs sem itens: cobertas pelo open-load; backfill batch só se o Pedro pedir.
2. Recuperação de wipados: **só se L0.2(c) encontrar casos** (censo sugere que não há).
3. Herdados: buracos de descoberta (~90 pedidos ausentes) — disparo com `ped_window_days` maior, fora de janela de cron.

### L6 — Validação fim-a-fim (operação real, evidências no diário)
0004441 abre com itens (loading visível) · aprovação 100% → e-mail ao criador ≤15min · conclusão → e-mail ao requisitante · cancelado no Alvo → badge no open · excluído no Alvo → badge no open · operadora cadastra produto+fornecedor no Alvo → botão → aparecem no wizard · filtro novo bate com o CASE SQL · replicar correções de narrativa nos reports consolidados.

---

## 4. Pendências de decisão do Pedro
| # | Decisão | Status | Bloqueia |
|---|---|---|---|
| P-1 | Arquitetura estado+scan para os DOIS e-mails | **proposta, aguarda ok** | L2 |
| P-2 | "Pendente" do Alvo: significado operacional (status próprio no filtro ou agrupado?) | aberta | L4.1 (não trava resto) |
| P-3 | Neutralizar TODOS os ~1.150 concluídos históricos (zero e-mail retroativo) | aguarda confirmação | L2.2 |
| P-4 | Gate do botão = role Operador de Compras (Elisangela, Mirlene, Ryan) | aguarda confirmação | LD/L4.4 |
| P-5 | E-mail de Concluído exige `aprovado='Total'` junto (exclui 5 anomalias legadas)? | proposta | L2.2 |
| P-6 | Cancelamento notifica alguém? (sugestão: não, por ora) | aberta | — |
| ~~D-1/D-2~~ | Concluído=`Encerrado`; requisitante SÓ na conclusão; criador na aprovação 100% | **decididas 17/07** | — |

---

## 7. Referência técnica

### Constantes
Supabase `hbtggrbauguukewiknew` · Hub `finance-pf.lovable.app` · Gateway `https://erp-proxy.onrender.com` · Alvo `pef.it4you.inf.br/api` filial `1.01` · Remetente Resend `noreply@notificapfbr.com.br` (domínio verificado sa-east-1) · MCP read-only `...project_ref=hbtggrbauguukewiknew&read_only=true&features=database` · Caso-referência itens: pedido **0004441** · Operadoras com `alvo_usuario`: PEDRO.SCRIGNOLI, ELISANGELA.SILVA, MIRLENE.OLIVEIRA (Ryan pendente L0) · Identidade: `criado_por_user_id=profiles.user_id=auth.uid` (≠`profiles.id`).

### Sync de status (`sync-compras-status-cron`)
4 jobs: J4 descoberta reqs → J3 descoberta peds → J1 mudanças reqs → J2 mudanças peds. Auth `CRON_SECRET`; kill-switch `sync_settings` (`job_name='sync-compras-status-cron'`); `sync_runs.job_type='bicephalous'`; schedule ~1x/hora (confirmar jobid no L0 — não é o 14/intercompany). J2: Load individual, chunks 5, LIMIT 100, rodízio `synced_at ASC NULLS FIRST`; e-mails: inline `aprovouAgora`→notify-pedido-aprovado (SERÁ REMOVIDO, L2.3). J3/J4: janela 30d, reconciliação na janela, cursores `ped/req-comp-last-numero-1.01`, override `ped_window_days` em disparo manual. Descoberta insere SÓ cabeçalho (`detalhes_carregados=false`, flag hoje órfã — vira gatilho do L1.4).

### E-mails
`notify-pedido-criador`: `--no-verify-jwt`, HOJE SEM AUTH (L2.1), cron jobid 21 `*/15 * * * *`, dedup `compras_pedidos_emails_log` `tipo='aprovacao_criador'` + anti-duplo por endereço, elegibilidade `criado_no_hub=true AND aprovado='Total' AND status_aprovacao='Finalizada' AND criado_por_user_id NOT NULL`, modos scan/single(force_test/override_email), linhas `backlog-neutralizado`. `notify-pedido-aprovado` (requisitante): hoje na aprovação via inline; migra para Concluído (L2.2).

### erp-proxy
Detalhe: `PedComp/Load?...loadParent=All&loadChild=All&loadOneToOne=All` (traz ItemPedCompChildList; 404 por regex na Message; **repassa 200-null — L3.1**). `/ped-comp/list`: janela ≤31d imposta pelo proxy, paginação interna MAX_PAGES=50 com truncamento silencioso. Auth global JWT OU `X-System-Secret`. Escrita: `/insert-multipart` (SaveMultiPart, 3×5MB, truncamento Texto 4000/Hist 2000), `/update` (SavePartial, objeto completo), `/atualiza-item-pedido` (enriquecimento fiscal pré-insert obrigatório). Token: Login+SelectCompany, cache 25min, retry 401/403/409.

### Catálogo de produtos (base do LD)
Fluxo vivo: `sincronizarProdutosDoERP` (alvoEstoqueService.ts) → `POST /estoque/produto-sync` `{pageIndex,pageSize:500}` → itens com `Codigo,Nivel,Grupo,CodigoTipoProduto,Reduzido,Alternativo,Nome,NomeAlternativo3,CodigoBarras,CodigoClasFiscal,CodigoTipoProdFisc,`**`DataCadastro`** → filtra grupos (`!Nivel || Codigo===Nivel || Grupo==='T'`) → **RPC `sync_stock_products_from_erp`** (SECURITY DEFINER, lotes 200, preserva codigo_alternativo/unidade_medida; existe porque PATCH é bloqueado no CORS). `sync_runs` `job_type='produtos'` = cron + botão manual; "Atualizado em" da tela filtra esse job_type sem erros e sem watchdog → **LD usa job_type próprio**. Tabela `stock_products` (chave `codigo_produto`, upsert por `id`). Legados da tela (NÃO usar no LD): Importar XLSX (seed), Importar Código Alternativo, Enriquecer Unidades. `fetchProducts` pagina com `.range()` 1000 — padrão a copiar no ProductCombobox. Entidades: sync separado, contrato a ler no L3.2.

### Armadilhas
Frontend nunca `.update()` (CORS bloqueia PATCH) → upsert/RPC POST · `CREATE OR REPLACE FUNCTION` não preserva SECURITY DEFINER/search_path; DROP antes de mudar assinatura; `NOTIFY pgrst,'reload schema'` após DDL · PostgREST hosted max-rows=1000 → `.range()` · PostgREST `in.()` com espaço exige aspas duplas · NOT IN com NULL exclui a linha · neutralizar backlog ANTES de ligar scan de notificação · falhas de sync silenciosas → conferir `sync_runs` · Vite após dependência nova → hard refresh antes de caçar bug.

---

## 8. Diário (append-only)
| Data | Item | Registro |
|---|---|---|
| 2026-07-16 | v1 | Plano criado (prompts 46.0–46.10). |
| 2026-07-17 | pré-diag | Código lido no chat (cron, notify, pedidosService, erp-proxy, InventoryImport, alvoEstoqueService). Confirmados: wipe 200-null (mecanismo), starvation 404, filtro excluindo NULL, itens descartados pelo J2, notify sem auth, flag detalhes_carregados órfã. Descartados: janela 31d p/ status, códigos 01.00x. |
| 2026-07-17 | censo | Censo de status Hub (SQL) × Alvo (Console, 8 janelas): mesmas 16 combinações; defasagem ~150 Encerrados + ~90 ausentes; 7 NULL = rascunhos. Vocabulário oficial na seção 1. |
| 2026-07-17 | v3 | Decisões: Concluído=`Encerrado`; criador no 100% aprovado; requisitante SÓ no Concluído; open-load a cada abertura de card; delta de cadastros (produtos+entidades) via RPC existente; mapa de status efetivo aprovado em revisão. Plano reorganizado (L0,L1,L3,L2,LD,L4,L5,L6). Nada executado ainda. |
| 2026-07-17 | L0 | Pre-flight OK. Achados que corrigem o plano: (a) 7 status NULL são `status_local='erro_envio'` (NÃO 'rascunho') e NÃO existe nenhum pedido 'rascunho' na base; (b) UNIQUE (pedido_id,sequencia) JÁ existe → sem migration de itens; (c) zero wipes reais (2.256 sync_status) → L5.2 não ativa; (d) cron = jobid **1** `0 11-20 * * 1-5` GMT = 08–17h BRT (não 24h); produtos = jobid 20; **não existe cron de entidades**; (e) `status_local` é ENUM → migration `ALTER TYPE ... ADD VALUE 'excluido_alvo'` (aplicada por Pedro no SQL editor); (f) `statusPedido.ts` JÁ existe (L4.1 assume criar). **`supabase db push` PROIBIDO** (58 migrations locais divergentes; achado → CLAUDE.md). Quantidade de item = `QuantidadeProdUnidMedPrincipal` (26/26; Quantidade2 diverge em 22/1528). |
| 2026-07-17 | L1.2 | Filtro L1.2 exclui DOIS valores de `status_local` (`'erro_envio','excluido_alvo'`), **não três** — `'rascunho'` omitido de propósito: não existe na base e, se existisse, teria `status=null` já barrado pelo `.not("status",...)` e pelo `.or()`. Não "corrigir" achando que faltou valor. Encadeamento `.not(status)` + `.not(status_local)` = **AND** confirmado empiricamente (379 candidatos com AND vs 1.267 se houvesse sobrescrita) e pelo mecanismo (params raiz distintos no PostgREST). |
| 2026-07-17 | L1.3 | Count de diagnóstico do Job 2 grava em `sync_runs.observacao` (`Job2 elegíveis(sem limit)=N, limit=100`). Par de referência **pós-fix = 379/377** (NÃO 375/373 — a query de diagnóstico já usa aspas duplas, então conta o universo corrigido; base cresceu 1.643→1.646 desde o L0): **379 = ramo `status_aprovacao.in` ativo; 377 = inerte** (só o corte de data importa). Procurar 379 no `sync_runs` pós-deploy — 377 significaria que o fix das aspas não pegou. |
| 2026-07-17 | **L1 FECHADO (parcial)** | **Re-deploy cirúrgico OK — Correções 1/3/4 em produção.** Data-fix dos 7 rodado pelo Pedro (excluido_alvo→sincronizado, baseline=0). Deploy da versão sem a Correção 2 (18:04) + `manual_admin` (run 37531f39, 48s). **4 asserções passaram:** (a) `excluido_alvo`=**0** (Correção 2 fora); (b) persistência drenando — 127 itens em 38 pedidos, 40 flags viradas, `flag_incoerente`=0, itens 98→225, backlog 123→85 (as 2 flags a mais que pedidos-com-itens = Load só com `Cancelado='Total'`/lista vazia → flag vira, 0 linhas, projetado); (c) count logou `376`; (d) `total_erros`=0 + persistência limpa = type-check empírico (log do Edge indisponível — MCP é `features=database`; evidência empírica supre). **Correção 2 (404→excluido_alvo) relocada ao L3** com regra de cross-check (ver L3 item 4). **0004441 vira caso-teste do L3**: dá 404 no Load (persistência só roda após 200), então só ganhará itens quando o L3 corrigir o proxy — se o 404 for real, confirma exclusão via cross-check. Backup/corrigida preservados em scratchpad `L1-rollback/`. |
| 2026-07-17 | **L1 ROLLBACK** | **Deploy do L1 revertido no smoke test.** As 4 correções foram deployadas e disparadas via `manual_admin` (run 17:19, 46s, 0 erros de status). Correções 1/3/4 validadas OK: anti-wipe sem incidente; count diagnóstico gravou 378 e o **ramo `status_aprovacao.in` está ATIVO** (com_ramo 371 = só_data 369 + 2 exclusivos; 378 era snapshot pré-exclusão); **persistência de itens saudável** (59 itens em 44 pedidos, 45 flags viradas, 0 falhas de item). **PROBLEMA na Correção 2 (404→excluido_alvo):** marcou **7 pedidos** como `excluido_alvo`, incluindo o caso-referência **0004441** (descoberto da LISTA do Alvo ontem, 404 no detalhe hoje) e 0004430 (carregou com itens há 2 dias, 404 hoje). 6/7 nunca tiveram Load de detalhe bem-sucedido (404 crônico = "starvation 404" do pré-diag). **Diagnóstico:** o proxy é conhecidamente não-confiável no 404 (L3.1, "404 por regex na Message") e a Correção 2 não distingue exclusão real de 404 falso — premissa "404=excluído" é **prematura antes do L3**. Rollback = redeploy do backup (original); produção segura (401 OK). **Correção 2 precisa de redesenho** (gate no L3, ou exigir ausência da lista de descoberta, ou N 404s consecutivos) ANTES de re-deployar. **7 pedidos ficaram mis-marcados `excluido_alvo`** — data-fix pendente (reverter p/ `sincronizado`). Versão corrigida (1/3/4 + 2-a-redesenhar) preservada em scratchpad `L1-rollback/…CORRECTED-L1…`. |
| 2026-07-17 | L1.4 | **CORREÇÃO da decisão do L0 sobre cancelados.** O domínio real de `Cancelado` no `ItemPedCompChildList` é **{Não, Parcial, Total}** — `'Sim'` **NÃO existe** (a decisão original "pular `Cancelado='Sim'`" era um no-op; `resolverValorTotalAlvo`/`extrairDataAprovacaoAlvo` filtram `!== 'Sim'` e por isso na prática nunca excluem nada — dívida latente, fora do escopo L1). Evidência (4.535 itens da auditoria): **1.500 Não / 9 Parcial / 41 Total**. Skip do L1.4 = **`it.Cancelado === 'Total'`** (cancelado integral = item-fantasma, 22 pedidos); **grava Não + Parcial** (Parcial tem remanescente ativo — pular perderia item legítimo de 9 pedidos). Zero colunas NOT-NULL sem origem (varredura confirmou 0 nulos em Sequencia/CodigoProduto/CodigoProdUnidMed/QuantidadeProdUnidMedPrincipal/ValorUnitario/ValorTotal/ItemServico). **NÃO reconciliar `valor_total` do cabeçalho pela soma dos itens** — divergência por cancelamento parcial é legítima; cabeçalho é fonte da verdade. |
| 2026-07-17 | L3.1 (Missão 1/3) | **Código entregue — aguarda apply + deploy do Pedro (GitHub Web).** Guarda 502 na ORIGEM no `GET /ped-comp/:filial/:numero` (`erp-proxy/src/routes/ped-comp.ts`): após o bloco `!result.ok` e antes do `res.status(200).json(result.data)` final, se `result.data` não for objeto com `Numero` → **502 `Resposta inválida do Alvo`** (nunca mais 200-null). Fecha a ORIGEM do wipe; a guarda anti-wipe do L1.1 (já em produção) cobre o lado do cron. Insersção única de 22 linhas; **só o handler GET individual tocado** (`/list`,`/by-req`,`/insert-multipart`,`/update`,`/atualiza-item-pedido` intactos). Sem novo import (padrão `typeof … "object"` + `(result.data as any).Numero` já usado no arquivo). Entrega em `C:\Users\PFBR-2601-3\entrega-L3-ped-comp\` (`ped-comp.ts` completo + `DIFF.txt` + `LEIA.txt`) — Pedro cola via GitHub Web; **nada pushado por mim** neste repo. **Deploy fora da janela do cron** (08–17h BRT, jobid 1). Pós-deploy: **0004441** (caso-teste do L3) passa a dar **404 real** em vez de 200-null → destrava a Missão 2 (404→`excluido_alvo` com cross-check). Missões 2 e 3 pendentes. |
| 2026-07-17 | L3.1 VALIDADO | **Missão 1 aplicada pelo Pedro + deploy Render OK. Guarda 502 confirmada no caminho feliz: `0004449` (pedido são, ganhou itens no smoke) → 200 com `Numero`.** Guarda NÃO quebrou nada. **Cross-check com dado real nos 4 suspeitos** (`0004441`, `0003246`, `0004019`, `0004430`): todos **404 no Load E ausentes da `/ped-comp/list` em TODAS as janelas de 2026** → **exclusão REAL no Alvo** (não 404 falso). `0004441` é **pedido fantasma**: criado → descoberto pelo Job 3 → excluído no Alvo; o cron antigo nunca propagou a exclusão. O "card sem itens" era isso — **pedido morto, não bug de itens** (fecha a hipótese do L1/L5.1 para esse caso). **Placar 404-suspeitos: 4 exclusão real / 0 502-mascarado** → confirma a premissa da Missão 2 (o 404 pós-L3.1, cruzado com ausência da lista, é sinal confiável de exclusão). Missão 2 liberada para desenho. |
| 2026-07-17 | L3.2 (Missão 2/3) CODADA — aguarda deploy+smoke | **Encerramento do dia. Código escrito e diff APROVADO pelo Pedro, NO WORKING TREE, NÃO commitado, NÃO deployado** (deploy vem antes do commit, como no L1). Arquivo: `supabase/functions/sync-compras-status-cron/index.ts`. **Fiação J3→J2** (ordem real do handler J4→J3→J1→J2 confirmada no código): `syncDescobrirPedidos` passa a retornar `{ result, crossCheck }`, onde `crossCheck = { listaOk, janelaInicio, janelaFim, numerosVistos:Set<'filial\|Numero'> }`; handler guarda e passa como 4º param ao `syncPedidos`. **Regra (helper `avaliarExclusaoPedido`):** 404 real → marca `excluido_alvo` SÓ se (a) `listaOk` E (b) `data_pedido` DENTRO de [janelaInicio,janelaFim] varrida E (c) número AUSENTE do `numerosVistos`; 404+presente=soluço→no-op; fora da janela/sem lista→no-op. **Trava de truncação (exigência do Pedro):** Job 3 pede `pageSize=200` e liga `listaOk=false` se `todosPedidos.length >= 200×50(=LIST_CAP)` — page-equivalente (o proxy só devolve 10000 se consumiu as 50 páginas cheias; item-count é o único observável), borda erra p/ no-op. **Marcação idêntica ao spec:** UPDATE só `status_local='excluido_alvo'`+`synced_at`(+`updated_at`)+auditoria `evento='excluido_alvo'`; NÃO toca status/aprovado/status_aprovacao/comprado. **Filtro de candidatos:** `+data_pedido` no SELECT + NULL-safe `.or("status_local.is.null,status_local.neq.excluido_alvo")` no SELECT **e** no count de diagnóstico (alinhados). `git diff --stat`: 1 arquivo, +~150/-~10. **3 verificações read-only OK** (fingerprint `compras_pedidos`=1649): (1) enum `compras_pedido_status_local` TEM `excluido_alvo` (ordem 6); (2) `status_local NULL`=**0**; (3) `data_pedido` **100% populada** (0 nulos) → nenhum fantasma cai no no-op por data nula. **DESCOBERTA OPERACIONAL (bloqueia smoke de janela larga):** `call_sync_compras_status_cron(text)` só monta `body:=jsonb_build_object('triggered_by',…)` — **NÃO repassa `ped_window_days`**; `select call_...('manual_admin')` roda 30d fixo. Para 365d: **opção B** (net.http_post one-off no SQL editor lendo o secret do Vault e injetando `ped_window_days:365` no body) OU **opção A** (dar 2º param `p_ped_window_days` à função via DDL DROP+CREATE — momento calmo, rollback = recriar versão de 1 param). **Datas dos 4 fantasmas** (hoje 2026-07-17, corte 30d=2026-06-17): `0004441`(2026-07-16) e `0004430`(2026-07-15) = **dentro de 30d** (cron normal marca); `0004019`(2026-05-24) e `0003246`(2026-01-29) = **exigem 365d** (senão guarda de janela dá no-op). Todos os 4: `status='Aberto'`, `status_local='sincronizado'` → candidatos válidos do Job 2. **Canário:** `elegiveis_sem_limit` medido ANTES de marcar; baseline recente 375-378; na run do smoke deve ficar ~375 (estável); pós-smoke ~371 (queda de **exatamente ~4** = efeito legítimo dos fantasmas saindo do pool; queda muito além de 4 = os dois `.or()` interagiram errado = bloqueador). Config: `verify_jwt=false` já no `config.toml`. **RETOMADA amanhã (fora da janela do cron):** (1) `supabase functions deploy sync-compras-status-cron --project-ref hbtggrbauguukewiknew`; (2) health check `curl -i POST … -d "{}"` → 401=viva; (3) smoke **opção B** com `ped_window_days=365`; (4) asserções (eu colho via MCP): count `excluido_alvo`=**exatamente os 4**, **zero são** marcado, `total_erros` sem novos, canário não cai além de ~4. Desvio = rollback (redeploy da versão anterior + data-fix `excluido_alvo→sincronizado`). |
| 2026-07-18 | **L3.2 (Missão 2/3) VALIDADA — EM PRODUÇÃO** | **Deploy da Edge OK (Pedro, `supabase functions deploy`) + smoke validado.** Run 30d `manual_admin` (11:43 UTC, 42s): **4 marcados `excluido_alvo`** — `0004238`(data_pedido 2026-06-18), `0004271`(06-22), `0004430`(07-15), `0004441`(07-16), cada um com auditoria `evento='excluido_alvo'` + `cross_check{janela 2026-06-18..2026-07-18, ausente_da_lista:true}`. `total_mudaram=7` (**4 exclusões + 3 status**), **`total_erros=0`**, **zero falso-positivo**. **Canário 374 estável** (medido ANTES de marcar; baseline 374-375). Os antigos `0003246`(jan) e `0004019`(mai) ficaram **FORA** (data_pedido > 30d → guarda de janela no-op = **correto**); o smoke achou 2 fantasmas novos dentro de 30d (`0004238`,`0004271`) → placar não é fixo em "os 4 de ontem", é "todo 404 real ausente da janela". **Fail-safe provado na prática:** a run de 365d (11:37, erro meu de janela) bateu no **`MAX_DAYS=31` do proxy → `/list` HTTP 400 → Job 3 `!resp.ok` → `listaOk=false` → cross-check no-op → 0 marcações** (`total_erros=1`=o 400; `total_mudaram=4`=só status). Ou seja: quando o Job 3 não entrega lista confiável por QUALQUER motivo, nada é marcado — a família de guardas `listaOk` (mesma da trava de truncação) segura. **CORREÇÃO do registro de ontem:** `ped_window_days` **NÃO** alcança 365 — o proxy limita a janela a 31d; a opção A/B só estica até ~31d. **Próxima run: canário deve cair p/ ~370** (os 4 saem do pool); queda muito além de 4 = bloqueador. **Commit de fechamento** = Edge `index.ts` + este diário (deploy veio ANTES do commit, padrão L1). |

## 9. Fora do escopo (não perder)
`alvo_comprador_codigo` (Pedro/Mirlene) · backfill `data_abertura_alvo` ~141 reqs + reqs históricas ausentes · elo perdido req↔ped (mitigado pela reconciliação) · paginação Inventory geral · cadastro de produto NO Alvo via Hub (descartado pela simplificação do delta; retomar se necessário) · validação funcional FH41 (absorvida no L6).

**Limpeza histórica de fantasmas excluídos (NOVO — descoberto no L3.2):** o cross-check da Missão 2 só cobre os **últimos ~31 dias** — o proxy `/ped-comp/list` impõe `MAX_DAYS=31` e a janela do Job 3 é sempre "hoje − N dias até hoje" (ancorada em hoje). Fantasmas com `data_pedido` além disso (ex.: `0003246` jan/2026, `0004019` mai/2026) **nunca** são alcançados pelo cron nem por `ped_window_days` (limitado a 31d). Cobri-los exige **tarefa própria**: varrer janelas sucessivas de ≤30 dias caminhando para trás — o que precisa de um disparo que aceite janela **ancorada no passado** `[dataInicio,dataFim]` (o Job 3 hoje só aceita "N dias a partir de hoje"), ou data-fix manual dos fantasmas históricos conhecidos. Não é um parâmetro — é um modo de varredura novo.
