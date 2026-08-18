# MISSÃO — Sync de Pedidos: rateio, cabeçalho e conformidade campo a campo
## Correção do sync + auditoria completa + backfill do ano corrente

> **Missão nova, independente da missão Aprovação de Requisições.** Estado próprio:
> `ESTADO-SYNC-PEDIDOS.md` (a criar). Documentos da outra missão permanecem intactos.
> Base factual: investigação de 14/08/2026 (sessão do Claude Code) + `DISCOVERY-FASE7A.md`.
> **Escrito para ser lido por sessão NOVA, sem contexto prévio.**

---

## 1. O problema, em uma página

Desde o commit **`d44da61` (24/05/2026)**, os pedidos **nascidos no Alvo** (`criado_no_hub=false`)
entram no Hub **degradados**. O cron de descoberta (Job 1 + Job 2 em
`supabase/functions/sync-compras-status-cron/index.ts`) implementou apenas parte do mapeamento que o
loader antigo — `src/services/alvoPedCompService.ts:434-463`, do botão manual, **vivo, correto e
intocado desde 06/04/2026** — já fazia.

| Janela de descoberta | Pedidos | Com rateio Classe+CC | Com `centro_custo` |
|---|---:|---:|---:|
| Antes de 24/05 (loader antigo) | 1.061 | 99,6% | 99,2% |
| Depois de 24/05 (cron `d44da61`) | 714 | **14,3%** | **35,7%** |

**Universo afetado:** 616 pedidos · **R$ 6.641.543,44** · `data_pedido` de 28/11/2025 a 13/08/2026.
Destes, 462 sem CC por nenhuma fonte e **287 com `detalhes_carregados=true`** — ou seja, **o payload
completo chegou ao Hub e foi descartado**.

**Por que ninguém viu:** status e os 7 campos de valor continuaram corretos. O sync "funcionava".
Só apareceu quando se pediu visão por centro de custo — 57% do gasto de agosto (R$ 937 mil) sem CC.

### 1.1 Dois defeitos, não um

**D1 — Mapeamento incompleto (Job 2).** `persistirItensPedido` (`:1163`) faz o Load completo e mapeia
14 campos planos do item, mas **não lê** `ItemPedCompClasseRecdespChildList` → o bloco de rateio chega
no payload e é jogado fora.

**D2 — Campo gravado uma vez, nunca completado.** O Job 1 (`:980`) grava `centro_custo` do
`/ped-comp/list` (leve) **só na primeira descoberta**, e `if (existingPed) { … continue; }` impede
qualquer revisita. Consequência independente do D1: campo que veio vazio na descoberta fica nulo
**para sempre**, mesmo com o Load trazendo o dado depois.
Caso real: pedido **`0004664`, R$ 110.000,00, sem fornecedor** — `codigo_entidade='0001173'` veio,
`NomeEntidade` não, e o cron nunca revisitou. O loader antigo tinha fallback
(`pedido.NomeEntidade || entidade?.nome`); o cron não tem.

### 1.2 Campos medidos como degradados (cobertura % por coorte)

| Campo | mar/26 | ago/26 | Escritor perdido |
|---|---:|---:|---|
| `centro_custo` | 99 | **21** | Load → rateio |
| `classe_rec_desp` | 100 | **9** | Load → rateio |
| `classe_rateio` (jsonb) | 100 | **9** | Load → rateio |
| `itens` (jsonb) | 100 | **9** | Load |
| `parcelas` (jsonb) | 99 | **8** | Load |
| `primeiro_vencimento` | 99 | **8** | Load |
| `cnpj_entidade` | 97 | **43** | Load + fallback entidade |
| `nome_cond_pag` | 80 | **48** | Load |

Não afetados: `codigo_entidade`, `nome_entidade` (99%), `codigo_cond_pag`, status e os 7 campos de valor.

---

## 2. Decisões do Pedro (14/08/2026)

| # | Tema | Decisão |
|---|---|---|
| S1 | jsonb × normalizado | **Gravar os dois** durante a transição. `ConfirmarLancamentoModal.tsx:295,340` e a tela de vincular leem `classe_rateio`; parar de gravá-lo agora quebraria as duas. Aposentadoria do jsonb = tarefa própria, depois de a normalizada estar populada e as telas migradas |
| S2 | `cnpj_entidade` / `nome_entidade` | **Voltar a escrever**, com o fallback do loader antigo. Pedido tem que ter entidade |
| S3 | Backfill | **Somente ano corrente (2026)**, sem duplicar |
| S4 | Escopo da auditoria | **Ampliado:** não só rateio/CC — conferir **todos** os campos mapeados (§4.2) |
| S5 | Ordem | **Corrigir o fluxo primeiro**, provar em ciclo real, **e só então** o backfill. Backfill com o furo aberto é tirar água sem tapar o buraco |

---

## 3. Regras de engajamento (valem para toda sessão desta missão)

1. **`git pull` antes de tudo.** O Lovable também escreve na `main`.
2. **MCP Supabase é read-only.** O agente lê; **toda escrita (DDL/DML) é do Pedro**, no SQL Editor.
   Precisa de SQL? Escrever em arquivo para ele colar — nunca executar.
3. ⚠️ **Tags nomeadas** (`$fn$`, `$r1$`…) em todo `CREATE FUNCTION` — o SQL Editor corrompe corpos
   `$$` em silêncio.
4. ⚠️ **`text` não significa domínio livre** — conferir **CHECK constraint** antes de introduzir valor
   novo em coluna de status/tipo. Já mordeu duas vezes.
5. **`CREATE OR REPLACE` não preserva `SECURITY DEFINER`/`search_path`.** Recriar funções a partir do
   **`pg_get_functiondef` do banco**, nunca da especificação.
6. **`revoke execute` precisa dos DOIS:** `from anon` **e** `from public` (o Postgres concede a PUBLIC
   por default; revogar só de anon não fecha). A regra do `CLAUDE.md` está incompleta.
7. **Staging explícito.** Proibido `git add -A` / `.`. `types.ts` em skip-worktree — não tocar.
8. **Sem push** sem autorização. **Publicar** é só do Pedro.
9. **Edge Function:** deploy via CLI com `--project-ref hbtggrbauguukewiknew`, **fora das janelas do
   cron (07h30 / 12h30 / 16h30 BRT)** ou com kill-switch em `sync_settings`; **confirmar que a função
   responde depois** (deploy fantasma já aconteceu) e conferir `sync_runs` — **falha de sync aqui é
   silenciosa**.
10. **Fallback nunca silencioso.**
11. **Anti-wipe:** não tocar em `status`, `valor_total` nem nos 7 campos de valor. O total de agosto
    (**R$ 1.642.742,28**, 92 pedidos) é âncora de reconciliação e **não pode mudar**.

---

## 4. FASE S0 — Discovery (100% leitura). Saída: `DISCOVERY-SYNC-RATEIO-PEDIDOS.md`

### 4.1 Bloqueadores técnicos (medir antes de qualquer proposta)

- **S0-1. ⚠️ CRÍTICO — chave única de `compras_pedidos_itens_rateio`.** Listar índices e constraints
  (`pg_indexes`, `pg_constraint`). A única conhecida é `(item_id, codigo_classe_rec_desp,
  codigo_centro_ctrl)`. **Sem UNIQUE, o reprocesso duplica linhas e o rateio deixa de fechar 100%.**
  Se faltar: propor o `CREATE UNIQUE INDEX` (SQL para o Pedro colar) e **verificar duplicatas
  pré-existentes** antes, porque o índice falha se houver.
- **S0-2.** Estrutura completa das três tabelas (`compras_pedidos`, `_itens`, `_itens_rateio`):
  colunas, tipos, FKs, CHECK constraints (regra 4), e como `item_id` liga item↔rateio.
- **S0-3.** Hoje: `select count(*), count(distinct item_id) from compras_pedidos_itens_rateio;` e a
  soma de `percentual` por item — confirmar que fecha 100,0000 nos 125 itens medidos.
- **S0-4.** O `if (existingPed) continue` (Job 1, `:980`): mapear **todos** os campos que ele grava e
  que nunca mais são revisitados. É o D2 — a lista completa, não só `centro_custo` e `nome_entidade`.
- **S0-5.** Filtro do Job 2 (`:1323`): `status not in ('Encerrado','Cancelado','Cancelado Parcial')`
  a menos que `detalhes_carregados=false`. Quantos dos afetados **nunca mais serão visitados** pelo
  cron? (medido antes: 97 de 287; confirmar e recalcular para o recorte 2026).

### 4.2 Matriz de conformidade campo a campo (S4 — o pedido do Pedro)

Montar uma tabela com **uma linha por campo mapeado** do pedido, contendo: campo no Hub · origem no
Alvo (caminho no payload do `Load` ou do `list`) · **quem escreve hoje** (loader antigo / Job 1 /
Job 2 / ninguém) · cobertura % **antes e depois de 24/05** · veredito (ok / degradado / nunca escrito).

Campos a cobrir, **no mínimo** — não parar nos 8 já conhecidos:

- **Cabeçalho:** número, filial, entidade (código, nome, CNPJ), `centro_custo`, `classe_rec_desp`,
  `status`, `status_aprovacao`, datas (`data_pedido`, `data_cadastro`, `data_entrega`,
  `data_validade`, `data_digitacao_alvo`, `data_aprovacao_alvo`), condição de pagamento
  (código e nome), `primeiro_vencimento`, `numero_req_comp` / vínculo com requisição,
  **observações do cabeçalho**, comprador/usuário do Alvo, e **quem aprovou no ERP** (se o payload traz).
- **Valores:** `valor_total`, `valor_mercadoria`, `valor_servico`, `valor_frete`, `valor_desconto`,
  `valor_ipi`, `valor_outras_despesas` — conferir que **somam** e batem com o Alvo (regra 11: medir,
  não corrigir).
- **Itens:** sequência, produto (código, código alternativo, nome), unidade de medida, quantidade,
  valor unitário, valor total do item, **observações do item**, prazo/entrega do item.
- **Rateio:** classe (código e label), centro de custo (código e label), **percentual**, valor.
- **Parcelas:** número, vencimento, valor.
- **Anexos:** o pedido do Alvo tem anexos? Existe rota no gateway? Chegam ao Hub hoje? (Se não
  existir suporte, **dizer isso** — é achado, não omissão.)

### 4.3 Prova de fogo — 3 pedidos comparados campo a campo

Contagem de preenchimento revela o que está **nulo**; não revela o que está **errado**, que é pior e
invisível. Escolher **3 pedidos de 2026** e comparar o payload do `Load` contra a linha no Hub,
campo a campo:

1. um **com rateio multi-CC**;
2. um **sem rateio** (CC só no cabeçalho);
3. um **vindo de requisição do Hub** (`criado_no_hub=true`, o caminho que se supõe correto).

Relatar divergências de **valor**, não só de ausência. Se não for possível fazer o Load ao vivo
(o gateway exige JWT de usuário; anon → 401), **dizer isso** e usar os `payload`/`detalhes` já
persistidos, deixando claro o limite da evidência.

### 4.4 Perguntas a fechar com o Pedro

Listar o que só ele decide — no mínimo: aposentadoria do jsonb (quando), tratamento dos 2 pedidos
`excluido_alvo` (404 esperado), e o pedido `0004495` (25/08, itens somando o dobro do cabeçalho:
dado correto ou erro de digitação no Alvo?).

**Gate de saída S0:** `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` na raiz com S0-1…S0-5, a matriz §4.2 e a
prova §4.3, cada achado com evidência. Commit com staging explícito, **sem push**.

---

## 5. FASE S1 — Correção do sync (antes do backfill — S5)

Arquivo: `supabase/functions/sync-compras-status-cron/index.ts`. **Referência de implementação:
`src/services/alvoPedCompService.ts:434-463`** — o mapeamento correto já existe, é portar, não inventar.

**A.** `persistirItensPedido` passa a mapear
`ItemPedCompChildList[].ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[]` para
`compras_pedidos_itens_rateio` (`codigo_classe_rec_desp`, `classe_rec_desp_label`,
`codigo_centro_ctrl`, `centro_ctrl_label`, `percentual`), **upsert pela chave única do S0-1**.

**B.** Job 2 volta a gravar os campos de cabeçalho perdidos: `centro_custo`, `classe_rec_desp`,
`primeiro_vencimento`, `nome_cond_pag`, `cnpj_entidade` (com fallback pela entidade — S2), e —
durante a transição (S1) — também `classe_rateio` e `itens` (jsonb).

**C.** Quebrar a dependência de "primeira descoberta" (D2): o Job 2 deve poder **completar campo
nulo** de pedido já existente. O `list` é leve; o **Load é a fonte autorizada**.

**D.** Aplicar o mesmo a `nome_entidade` (caso `0004664`).

**Gate de saída S1:** deploy fora das janelas do cron · função responde ao teste · **um ciclo real
do cron** executado · pedido novo nascido no Alvo entra **completo** (rateio + cabeçalho) ·
`sync_runs` sem falha · **agosto continua reconciliando em R$ 1.642.742,28**.

---

## 6. FASE S2 — Backfill dirigido (só depois do S1 provado)

- **Escopo:** pedidos de **2026** (S3), `criado_no_hub=false`, sem rateio. Recalcular o número exato
  no S0 (dos 616 totais, quantos são 2026).
- **Escrita mínima:** só rateio e os campos derivados. **Não tocar** em `status`, `valor_total` nem
  nos 7 campos de valor (regra 11).
- **Ritmo:** lotes de ~25 Loads com pausa, fora das janelas do cron. São chamadas ao Alvo via gateway.
- **Duas passadas numa só:** os que não têm itens precisam do Load de qualquer jeito — mesmo payload
  serve para itens e rateio.
- **Erros esperados:** 404 nos `excluido_alvo`. Logar e seguir — pela regra do cross-check, 404
  isolado não prova exclusão.
- **Rollback:** carimbar `t0` antes de começar. Reverter = `delete from compras_pedidos_itens_rateio
  where created_at >= t0` + limpar os campos preenchidos na janela.
- **Validação:** cobertura por mês sobe de 14,3% para perto de 99% · agosto **não muda**
  (R$ 1.642.742,28) · refazer a §C1.5 do `DISCOVERY-FASE7A.md` e comparar.

---

## 7. Fora de escopo

Aposentar os jsonb (`classe_rateio`, `itens`) · migrar as telas que os leem · fechar RLS
(**DÍVIDA-RLS-COMPRAS-REQ**) · sync de centros de custo fora do gateway
(**DÍVIDA-SYNC-CC-FORA-DO-GATEWAY**) · a missão Aprovação de Requisições (o bug do detalhe, A1.4,
é independente e segue seu próprio caminho) · backfill de anos anteriores a 2026.

---

## 8. PROMPT S0 — colar na sessão nova do Claude Code

```
PROMPT S0 — Discovery da missão Sync de Pedidos (rateio, cabeçalho e conformidade)

Leia, nesta ordem: CLAUDE.md (siga o protocolo de início de sessão) → MISSAO-SYNC-PEDIDOS.md
(este é o escopo da sessão; contém todo o contexto necessário) → DISCOVERY-FASE7A.md (contexto:
foi o que revelou o problema, seção C1).

Execute SOMENTE a §4 do MISSAO-SYNC-PEDIDOS.md: Discovery, 100% leitura.
Nenhuma alteração de código, nenhum SQL de escrita, nenhum deploy, nenhum push.

Prioridade: S0-1 (chave única de compras_pedidos_itens_rateio) — sem ela o backfill duplica
linhas e o rateio deixa de fechar 100%. É o bloqueador de tudo.
Depois S0-2..S0-5, a matriz de conformidade §4.2 e a prova de 3 pedidos §4.3.

Se algum campo do §4.2 não existir no Hub ou não tiver rota no gateway (anexos, por exemplo),
diga isso explicitamente — é achado, não omissão.

Entregue DISCOVERY-SYNC-RATEIO-PEDIDOS.md na raiz. Git: staging explícito só desse arquivo,
commit "docs(compras): discovery sync de pedidos — rateio e conformidade". SEM push.
Termine com: resumo executivo, o que contradiz esta especificação, e as perguntas que só o
Pedro pode responder.
```

---

*Fim da especificação. Sequência: S0 (Discovery) → S1 (correção + ciclo real provado) → S2 (backfill
2026). O bug do detalhe da requisição (Ajuste 7.1) é independente e pode correr em paralelo.*
