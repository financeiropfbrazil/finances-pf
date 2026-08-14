# DISCOVERY-SYNC-RATEIO-PEDIDOS.md — Fase S0 da missão Sync de Pedidos

> Execução do **PROMPT S0** (`MISSAO-SYNC-PEDIDOS.md` §4) — Discovery, 100% leitura.
> Sessão de **14/08/2026**. Nenhuma alteração de código, nenhum SQL de escrita, nenhum deploy,
> nenhum push. Contexto do problema: `DISCOVERY-FASE7A.md` §C1.

## 0. Protocolo de início de sessão (CLAUDE.md)

| Passo | Resultado |
|---|---|
| Prompt | **PROMPT S0 — Discovery da missão Sync de Pedidos** |
| `git remote -v` | `https://github.com/financeiropfbrazil/finances-pf.git` ✅ |
| `git branch --show-current` | `main` |
| `git log -1 --oneline` | `68bdac6 docs(suprimentos): discovery fase 7a -- visao do lider por CC` |
| `git pull origin main` | **Already up to date** — zero commits do Lovable |
| Projeto Supabase | `hbtggrbauguukewiknew` ✅ (`src/integrations/supabase/client.ts:5`) |

**Fingerprint (pré-voo):** `db=postgres` · `compras_pedidos = 1863` · `compras_pedidos_itens = 2600` ·
`compras_pedidos_itens_rateio = 139` · `compras_requisicoes = 323`.

⚠️ **O banco se move durante a sessão:** `compras_pedidos_itens` foi lido como 2599 → 2600 → 2602 em
~40 minutos. O cron está rodando. Toda contagem abaixo é um instantâneo de 14/08/2026.

---

# S0-1 · ⚠️ CRÍTICO — chave única de `compras_pedidos_itens_rateio`

## 🔴 Veredito: a chave não está só faltando — **ela está errada**. O caminho é outro.

### S0-1.a A tabela não tem UNIQUE nenhum além da PK sintética

```sql
select indexname, indexdef from pg_indexes where tablename='compras_pedidos_itens_rateio';
```
| índice | definição |
|---|---|
| `compras_pedidos_itens_rateio_pkey` | `UNIQUE (id)` — `gen_random_uuid()`, sintética |
| `idx_compras_pedidos_itens_rateio_item_id` | `btree (item_id)` — **não único** |

`pg_constraint`: só `pkey` e a FK `item_id → compras_pedidos_itens(id) ON DELETE CASCADE`.
**Nenhum UNIQUE de negócio. Confirmado: qualquer `upsert` hoje insere duplicata.**

Para contraste, as irmãs **têm** chave de negócio:
`compras_pedidos_itens` → `UNIQUE (pedido_id, sequencia)` · `compras_pedidos` → `UNIQUE (codigo_empresa_filial, numero)`.

### S0-1.b Existe duplicata pré-existente — e ela **não é lixo**

```sql
select count(*) grupos, sum(n)-count(*) excedentes from (
  select item_id, codigo_classe_rec_desp, codigo_centro_ctrl, count(*) n
  from compras_pedidos_itens_rateio group by 1,2,3 having count(*)>1) t;
```
→ **1 grupo, 1 linha excedente.** O `CREATE UNIQUE INDEX` proposto pela espec **falharia hoje**.

Mas o exame da linha muda a conclusão. Item `693d6db3…` (pedido `RASCUNHO-42c15eb8`,
`criado_no_hub=true`, 24/05/2026) tem **três** linhas de rateio:

| classe | centro de custo | percentual | `created_at` |
|---|---|---:|---|
| `03.02` | `00008.00002.00013` | 25 | 02:40:56.402 |
| `03.02` | `00008.00002.00013` | 25 | 02:40:56.643 |
| `25.07` | `00008.00002.000012` | 50 | 02:40:56.883 |

**Somam exatamente 100.** Os intervalos regulares (~240 ms) são de um **laço sequencial**, não de um
duplo clique. As duas linhas de 25% valem, juntas, 50% para aquele par classe+CC — **apagar uma
levaria o rateio de 100% para 75%**. Não é duplicata a limpar: é o domínio permitindo repetição.

### S0-1.c Por que a repetição é legítima — o Hub **achata** um percentual aninhado

`src/services/pedidosService.ts:1287-1296`:

```ts
for (const cls of item.rateio) {          // classe → percentual
  for (const cc of cls.ccs) {             // CC dentro da classe → percentual
    const percFinal = round2((cls.percentual * cc.percentual) / 100);
    await supabase.from("compras_pedidos_itens_rateio").insert({ …, percentual: percFinal });
```

O Alvo tem **duas camadas** (classe% × CC%); a tabela do Hub tem **uma**. Duas entradas da mesma
classe com o mesmo CC colapsam no mesmo par — e continuam sendo duas linhas corretas.
A tabela **não tem `sequencia`**, então não há como distingui-las por chave natural.

### S0-1.d O escritor que já existe **não usa upsert — usa delete-then-insert**

`src/services/pedidosService.ts:1129-1141` (`limparFilhosDoPedido`):

```ts
const { data: itensIds } = await supabase.from("compras_pedidos_itens").select("id").eq("pedido_id", pedidoId);
if (itensIds?.length) {
  await supabase.from("compras_pedidos_itens_rateio").delete().in("item_id", itensIds.map(i => i.id));
}
await supabase.from("compras_pedidos_itens").delete().eq("pedido_id", pedidoId);
```

O padrão de coleção-filha do módulo já é **apagar tudo do pai e reinserir**. É idempotente **sem
chave nenhuma**, tolera repetição legítima e não exige DDL.

### S0-1.e Recomendação — **não criar o índice; usar delete-then-insert por item**

| Opção | Veredito |
|---|---|
| `UNIQUE (item_id, codigo_classe_rec_desp, codigo_centro_ctrl)` + upsert | ❌ **falha hoje** (1 duplicata) e, pior, **proíbe um estado válido**. Só passaria consolidando as duas linhas em uma de 50% — mudança de dado, não de schema |
| Adicionar `sequencia` e usar `UNIQUE (item_id, sequencia)` | ⚠️ funciona, mas é DDL + mudança nos **dois** escritores (cron e wizard) + backfill da coluna nos 139 registros. Caro para o ganho |
| **`delete … where item_id in (…)` + insert, por pedido** | ✅ **recomendado.** Zero DDL, idempotente, espelha `limparFilhosDoPedido`, tolera repetição legítima |

⚠️ **Cuidado na implementação:** o delete tem de ser por **item do pedido em processamento**, nunca
global; e o Job 2 só deve apagar quando **tiver payload válido para reinserir** — apagar e falhar no
insert deixaria o pedido pior do que está (é o espírito da guarda anti-wipe L1.1).

> **Isto contradiz a espec:** `MISSAO-SYNC-PEDIDOS.md` §4.1-S0-1 e §5-A pedem "upsert pela chave
> única do S0-1". **A chave única não deve existir.** O S1 precisa ser reescrito nesse ponto.

---

# S0-2 · Estrutura real das tabelas

### `compras_pedidos_itens_rateio` (139 linhas · 125 itens)

| # | coluna | tipo | nulo? |
|---|---|---|---|
| 1 | `id` | uuid (PK, `gen_random_uuid()`) | não |
| 2 | `item_id` | uuid → **FK** `compras_pedidos_itens(id)` **ON DELETE CASCADE** | não |
| 3 | `codigo_classe_rec_desp` | text | não |
| 4 | `classe_rec_desp_label` | text | sim |
| 5 | `codigo_centro_ctrl` | text | não |
| 6 | `centro_ctrl_label` | text | sim |
| 7 | `percentual` | numeric | não |
| 8 | `created_at` | timestamptz `now()` | não |

🔴 **Não existe coluna `valor`** — e o Alvo manda `Valor` em toda linha de rateio (medido no §4.3).
🔴 **Não existe `sequencia`** (ver S0-1.c) nem **`updated_at`**.

### `compras_pedidos_itens` (2.600 linhas)
`id` (PK) · `pedido_id` (**FK** → `compras_pedidos`, CASCADE) · `sequencia` · `item_servico` ·
`codigo_produto` · `codigo_alternativo_produto` · `codigo_prod_unid_med` · `produto_nome` ·
`produto_unidade` · `quantidade` · `valor_unitario` · `valor_total_item` · `observacao` ·
`created_at` · `updated_at`. **`UNIQUE (pedido_id, sequencia)`** ✅ — o upsert de itens do cron é seguro.
**Sem coluna de centro de custo, classe, ou data/prazo de entrega do item.**

### `compras_pedidos` (1.863 linhas · 61 colunas)
PK `id` · **`UNIQUE (codigo_empresa_filial, numero)`** · FK `criado_por_user_id → auth.users`.
**Uma única CHECK constraint em toda a família** (regra 4 do CLAUDE.md):

```sql
compras_pedidos_vinculo_requisicao_check
  CHECK (vinculo_requisicao = ANY (ARRAY['com_vinculo','sem_vinculo','nao_verificado']))
```

`status_local` é **enum** (`USER-DEFINED`) — valor novo exige `ALTER TYPE` antes do código.
`status`, `aprovado`, `comprado`, `tipo`, `status_aprovacao` são `text` **sem CHECK** — domínio livre.

### Tabelas-filhas vizinhas
`compras_pedidos_parcelas` (201 linhas / 92 pedidos): `sequencia`, `numero_duplicata`,
`dias_entre_parcelas`, `percentual_fracao`, `valor_parcela`, `data_vencimento`. **Sem UNIQUE de
negócio** — mesmo problema do rateio, mesma solução.
`compras_pedidos_arquivos` (54 linhas / 50 pedidos): tabela **do Hub** (`storage_path`,
`upload_identify_guid`, `uploaded_by_user_id`) — ver §4.2 · Anexos.

---

# S0-3 · O rateio fecha 100%?

```sql
select round(soma,4), count(*) from
 (select item_id, sum(percentual) soma from compras_pedidos_itens_rateio group by item_id) t
group by 1;
```
→ **linha única: `100.0000` · 125 itens.** ✅ Confirmado — **inclusive** o item com a repetição do
S0-1.b (25 + 25 + 50 = 100). A invariante está intacta hoje.

🔴 **Mas ela quebra se o achatamento for portado como está.** Simulei `round2(classe% × cc% / 100)`
sobre o rateio real do pedido `0003625` (2 classes × 8 e 4 CCs = 12 linhas):

| | |
|---|---|
| soma **sem** arredondar | `100.00000000000000000000` |
| soma com `round2` por linha (o que o wizard faz) | **`100.02`** |
| erro | **+0,02 p.p.** |

Ou seja: portar o mapeamento do wizard para o cron **introduziria** a quebra da invariante
exatamente no tipo de pedido que a missão quer recuperar (multi-CC, muitas linhas). Com 2 casas, 12
linhas e percentuais de 4 casas no Alvo, o erro é estrutural, não acidental.

**Consequência para o S1:** ou `percentual` passa a guardar mais casas, ou a última linha de cada
item absorve o resíduo, ou o Hub guarda as **duas** camadas. **Decisão de projeto, não detalhe de
implementação** — está nas perguntas do §7.

---

# S0-4 · O D2: campos gravados uma vez e nunca revisitados

`supabase/functions/sync-compras-status-cron/index.ts:980` — Job 1 (descoberta):

```ts
if (existingPed) { if (ped.Numero > maiorNumeroVisto) maiorNumeroVisto = ped.Numero; continue; }
```

Job 1 grava 27 campos (`:986-1035`). Job 2 (`:1491-1528`) revisita **21**. Diferença = **os campos
congelados na primeira descoberta, para sempre**:

| Campo congelado | Origem no Job 1 | Job 2 revisita? |
|---|---|---|
| `tipo` | `ped.Tipo` | ❌ |
| `data_pedido` | `dateOnly(ped.DataPedido)` | ❌ |
| `data_cadastro` | `dateOnly(ped.DataCadastro)` | ❌ |
| `data_entrega` | `dateOnly(ped.DataEntrega)` | ❌ |
| `data_validade` | `dateOnly(ped.DataValidade)` | ❌ |
| `codigo_entidade` | `ped.CodigoEntidade` | ❌ |
| **`nome_entidade`** | `ped.NomeEntidade` | ❌ ← caso `0004664` |
| `codigo_cond_pag` | `ped.CondPagPedCompObject?.CodigoCondPag` | ❌ |
| **`centro_custo`** | `ped.CodigoCentroCtrl` (do **list leve**) | ❌ ← o D1+D2 combinados |
| `codigo_usuario` | `ped.CodigoUsuario` | ❌ |
| `texto` | `ped.Texto` | ❌ |

**11 campos.** A espec cita 2; são 11. Os 21 que o Job 2 revisita são status (7), datas do Alvo (2),
valores (7) e vínculo (5) — esses estão saudáveis.

Além disso, **9 campos nunca são escritos por nenhum dos dois jobs**: `cnpj_entidade`,
`classe_rec_desp`, `classe_rateio`, `itens` (jsonb), `parcelas` (jsonb), `anexos` (jsonb),
`nome_cond_pag`, `primeiro_vencimento`, `texto_historico`.

---

# S0-5 · O filtro do Job 2 e quem o cron nunca mais visita

`:1323` — a fila do Job 2:

```ts
.or('and(status.not.in.("Encerrado","Cancelado","Cancelado Parcial")),and(detalhes_carregados.is.false)')
```

Universo afetado (`criado_no_hub=false` **e** sem rateio no jsonb), recortado para **2026** (decisão S3):

| | |
|---|---:|
| Afetados no total | **616** |
| **Afetados em 2026** | **615** (só 1 é de 2025 — `data_pedido` 28/11/2025) |
| **Valor 2026** | **R$ 6.640.908,54** |
| Nunca mais visitados (encerrado/cancelado **e** `detalhes_carregados=true`) | **97** |
| Fila de primeira carga (`detalhes_carregados` ≠ true) | **328** |
| Ativos já carregados (o cron passa, mas não mapeia) | **190** |
| `status_local = 'excluido_alvo'` (404 esperado) | **2** |

✅ Os 97 da espec **confirmam-se em 97**. E o recorte 2026 praticamente não reduz nada: **615 de 616**.

**Leitura:** corrigir o mapeamento (S1) resolve sozinho os 328 da fila de primeira carga e os 190
ativos. Os **97 encerrados já carregados** ficam de fora **para sempre** sem backfill dirigido — são
a justificativa dura do S2.

---

# §4.2 · Matriz de conformidade campo a campo

## Os TRÊS escritores (a espec conhece dois)

| # | Escritor | Onde | Gatilho | Fonte |
|---|---|---|---|---|
| **A** | `syncPedidosCompra` | `src/services/alvoPedCompService.ts:240-490` | botão manual em `/compras/pedidos-compra` (tela intocada desde 06/04/2026) | `list` + `Load` |
| **B** | Job 1 + Job 2 do cron | `supabase/functions/sync-compras-status-cron/index.ts:986` e `:1163`/`:1491` | pg_cron | `list` (Job 1) + `Load` (Job 2) |
| **C** | 🔴 **`carregarDetalhesPedido`** | `src/services/alvoPedCompLoadService.ts:327-400` | **open-load do detalhe do pedido, a cada abertura** | `Load` |

> **Contradiz a espec:** `MISSAO-SYNC-PEDIDOS.md` §5 aponta **A** como "a referência de
> implementação". **C é melhor referência**: `extrairClasseRateio` (`:130-149`) tenta primeiro o
> rateio de **cabeçalho** (`PedCompClasseRecDespChildList`) e cai para o de **item**
> (`ItemPedCompClasseRecdespChildList`), aceitando `RateioPedCompChildList` **ou**
> `RateioItemPedCompChildList`. **A** só conhece o caminho do item. E **C** ainda extrai anexos.
> Assinatura de **C** no banco: **5 pedidos com `classe_rateio` preenchido e `centro_custo` nulo** —
> exatamente o que **C** produz (grava rateio, não deriva `centro_custo`).

## Cabeçalho

| Campo no Hub | Origem no Alvo | Quem escreve hoje | Cobertura mar/26 → ago/26 | Veredito |
|---|---|---|---:|---|
| `numero`, `codigo_empresa_filial` | `Numero`, `CodigoEmpresaFilial` (list) | A, B‑J1 | 100 → 100 | ✅ ok |
| `status`, `aprovado`, `status_aprovacao`, `comprado` | `Status`, `Aprovado`, `StatusAprovacao`, `Comprado` | A, B‑J1, **B‑J2**, C | 100 → 100 | ✅ ok |
| `tipo` | `Tipo` (list) | A, B‑J1 | — | ⚠️ congelado (S0-4) |
| `codigo_entidade` | `CodigoEntidade` | A, B‑J1 | 100 → **100** | ✅ ok |
| `nome_entidade` | `NomeEntidade` (+ fallback `entidade?.nome` **só em A**) | A, B‑J1 | 100 → **99** | ⚠️ congelado; 1 caso real (`0004664`, R$ 110.000) |
| **`cnpj_entidade`** | `CPFCNPJ` + fallback entidade | **só A** | 97 → **43** | 🔴 degradado |
| **`centro_custo`** | ⚠️ **duas origens distintas** (ver nota abaixo) | A (do rateio), B‑J1 (do list) | 99 → **21** | 🔴 degradado **e semanticamente errado** |
| **`classe_rec_desp`** | `classeRateio[0].classe` | **só A** | 100 → **9** | 🔴 degradado |
| **`classe_rateio`** (jsonb) | `PedCompClasseRecDespChildList` ‖ `ItemPedCompClasseRecdespChildList` | A, **C** | 100 → **9** | 🔴 degradado |
| `data_pedido`, `data_cadastro`, `data_entrega`, `data_validade` | `DataPedido`, `DataCadastro`, `DataEntrega`, `DataValidade` (list) | A, B‑J1 | 96–100 → 88–100 | ⚠️ congelados, mas saudáveis |
| `data_digitacao_alvo` | `DataHoraDigitacao` | B‑J1, B‑J2, C | — | ✅ ok |
| `data_aprovacao_alvo` | `extrairDataAprovacaoAlvo(alvo)` (item) | B‑J2, C | — | ✅ ok |
| `codigo_cond_pag` | `CondPagPedCompObject.CodigoCondPag` | A, B‑J1 | 100 → **96** | ⚠️ congelado |
| **`nome_cond_pag`** | `CondPagPedCompObject.Nome` (**só no Load**) | A, **C** | 80 → **48** | 🔴 degradado |
| **`primeiro_vencimento`** | derivado das parcelas | A, **C** | 99 → **8** | 🔴 degradado |
| `numero_req_comp`, `codigo_empresa_filial_req_comp`, `vinculo_requisicao`, `req_comp_itens` | `extrairVinculoRequisicao(alvo)` | B‑J1 (list), **B‑J2**, C | — | ✅ ok — o Job 2 mantém |
| **`texto`** (observação do cabeçalho) | `Texto` (list) | A, B‑J1 | 100 → **100** | ⚠️ congelado, saudável |
| **`texto_historico`** | `TextoHistorico` (**só no Load**) | **só A** | — | 🔴 nunca escrito pelo cron |
| `codigo_usuario` (comprador no Alvo) | `CodigoUsuario` | A, B‑J1 | — | ⚠️ congelado, saudável |
| `proximo_aprovador`, `enviou_aprovacao`, `data_notificacao_aprovador` | `PedCompUserFieldsObject.User*` | A, B‑J1, B‑J2, C | — | ✅ ok |
| **quem aprovou no ERP** | — | **ninguém** | — | 🔴 **não existe coluna no Hub.** Nenhum dos três loaders extrai identidade de aprovador — só `UserProximoAprovador` (**próximo**, não quem aprovou). Se o payload traz, só um Load ao vivo diz |

> ⚠️ **`centro_custo` tem duas origens que significam coisas diferentes** — é o padrão LIVRO × ESPELHO
> do CLAUDE.md. Em **A** é `classeRateio[0].centrosCusto[0].codigo` (a **primeira fatia do primeiro
> rateio**); em **B‑J1** é `ped.CodigoCentroCtrl` do cabeçalho do list. Ver o achado do §4.3.

## Valores (regra 11 — medir, não corrigir)

| Campo | Origem | Quem escreve | Veredito |
|---|---|---|---|
| `valor_total` | `resolverValorTotalAlvo(alvo)` (cabeçalho, fallback soma de itens) | A, B‑J1, **B‑J2**, C | ✅ ok |
| `valor_mercadoria`, `valor_servico`, `valor_frete` | `ValorMercadoria`, `ValorServico`, `ValorFrete` | A, B‑J1, **B‑J2**, C | ✅ ok |
| `valor_desconto` | `ValorDescontoGeral` | A, **B‑J2**, C | ✅ ok |
| `valor_outras_despesas` | `ValorOutrasDespesas` | A, **B‑J2**, C | ✅ ok |
| `valor_ipi` | `GeralValorIPI` | A, **B‑J2**, C | ✅ ok |

**Os 7 campos de valor são o que o cron faz certo** — e é por isso que a quebra passou 3 meses
invisível. ⚠️ Medido no `DISCOVERY-FASE7A.md` §C1.2 e **não corrigido aqui**: a soma dos itens **não**
reconcilia com `valor_total` (agosto: R$ 723.343,95 × R$ 525.339,83; `0004586` tem itens somando 4× o
cabeçalho). O cabeçalho é a fonte da verdade — a espec já manda não tocar.

## Itens

| Campo no Hub | Origem no Alvo (`ItemPedCompChildList[]`) | Quem escreve | Veredito |
|---|---|---|---|
| `sequencia` | `Sequencia` | B‑J2 (`persistirItensPedido`) | ✅ |
| `item_servico` | `ItemServico === "Sim"` | B‑J2 | ✅ |
| `codigo_produto` | `CodigoProduto` | B‑J2 | ✅ |
| `codigo_alternativo_produto` | `CodigoAlternativoProduto` | B‑J2 | ✅ 770/2.602 preenchidos |
| `codigo_prod_unid_med`, `produto_unidade` | `CodigoProdUnidMed` | B‑J2 | ✅ |
| `produto_nome` | `NomeProduto ?? DescricaoAlternativaProduto` | B‑J2 | ✅ 8 nulos em 2.602 |
| `quantidade` | `QuantidadeProdUnidMedPrincipal` | B‑J2 | ✅ |
| `valor_unitario`, `valor_total_item` | `ValorUnitario`, `ValorTotal` | B‑J2 | ✅ |
| **`observacao`** | `Observacao` | B‑J2 | ✅ 78/2.602 (67 gravados pelo próprio cron) |
| item cancelado | `Cancelado` — `'Total'` é **pulado** | B‑J2 (filtro) | ✅ por design |
| **prazo/entrega do item** | — | — | 🔴 **não existe coluna no Hub.** Achado, não omissão |
| **centro de custo do item** | `ItemPedCompClasseRecdespChildList[]` | 🔴 **ninguém** | 🔴 **é o D1** |

✅ **Boa notícia medida:** o mapeamento de itens do cron está **correto e completo** nos 11 campos que
mapeia — 2.565 dos 2.602 itens foram criados por ele. O defeito é de **omissão do bloco de rateio**,
não de valor errado. Confirmado item a item no §4.3.

## Rateio

| Campo no Hub | Origem no Alvo | Quem escreve | Veredito |
|---|---|---|---|
| `codigo_classe_rec_desp` | `…ClasseRecdespChildList[].CodigoClasseRecDesp` | só o wizard do Hub | 🔴 nunca vem do Alvo |
| `classe_rec_desp_label` | *(não vem no payload — o Hub usa o label do catálogo)* | só o wizard | 🔴 |
| `codigo_centro_ctrl` | `…[].Rateio*ChildList[].CodigoCentroCtrl` | só o wizard | 🔴 |
| `centro_ctrl_label` | *(não vem no payload)* | só o wizard | 🔴 |
| `percentual` | `Percentual` (**aninhado**, ver S0-3) | só o wizard, **achatado** | 🔴 + risco de arredondamento |
| **valor** | `Valor` — **o Alvo manda** | — | 🔴 **não existe coluna no Hub** |

## Parcelas

| Campo | Origem | Quem escreve | Veredito |
|---|---|---|---|
| `compras_pedidos.parcelas` (jsonb) | `extrairParcelas(data)` | A, **C** | 🔴 degradado 99 → 8 |
| `compras_pedidos_parcelas` (201 linhas / 92 pedidos) — `sequencia`, `numero_duplicata`, `dias_entre_parcelas`, `percentual_fracao`, `valor_parcela`, `data_vencimento` | — | **só o wizard do Hub** (`pedidosService.ts:1303`) | 🔴 **nenhum loader do Alvo popula a tabela normalizada.** Mesmo defeito do rateio, uma tabela ao lado |

## Anexos — **existe, sim; o binário é que não**

| Camada | Situação |
|---|---|
| **Payload do Alvo** | ✅ traz `PedCompArquivoChildList[]` com `Sequencia`, `Arquivo` (caminho no servidor), `CodigoUsuario`, `DataArquivo`, `Observacao` |
| **Extração** | ✅ `extrairAnexos` (`alvoPedCompLoadService.ts:151-165`) — escritor **C** |
| **No Hub** | ✅ `compras_pedidos.anexos` (jsonb) — **571 pedidos com anexo**, 1.863 com a coluna não-nula |
| **Cron** | 🔴 **não escreve `anexos`** (nem Job 1 nem Job 2) — degradado junto com o resto |
| **Binário do arquivo** | 🔴 **não chega.** Só o caminho (`\\servidor\...`). Nenhuma rota do gateway lê anexo do Alvo |
| **Rota no gateway** | 🔴 **não existe.** Rotas usadas no repo: `GET /ped-comp/{filial}/{numero}`, `POST /ped-comp/insert`, `/ped-comp/insert-multipart`, `/ped-comp/update`, `/ped-comp/atualiza-item-pedido`. A única multipart é de **envio**. `SPEC-D001-erp-proxy.md` **não menciona** `ped-comp` nem anexo |
| **`compras_pedidos_arquivos`** | tabela **do Hub**, não espelho: 54 linhas / 50 pedidos, alimentada só pelo upload do wizard (`storage_path` no Supabase Storage) |

> **Resposta explícita à §4.2:** o **metadado** de anexo já chega e já é gravado (por C, não pelo
> cron). O **arquivo** não chega e **não há rota** para buscá-lo. Baixar anexo do Alvo é
> funcionalidade nova no gateway (outro repo), fora do escopo desta missão.

---

# §4.3 · Prova de fogo — 3 pedidos, campo a campo

## ⚠️ Limite da evidência, declarado

**Não foi possível fazer o `Load` ao vivo.** O `erp-proxy` exige JWT de usuário do Supabase; a chave
anon pública devolve `401 {"error":"Token de autenticação inválido ou expirado."}` (o `/health`
responde `200 {"status":"ok","env":"production"}`). Usei então o **snapshot do payload já persistido**
— `compras_pedidos.itens` e `compras_pedidos.classe_rateio`, gravados pelos loaders A/C direto do
`Load` — comparado contra as tabelas normalizadas. É evidência de **o que o Alvo mandou naquele
momento**, não do estado de agora.

Descoberta lateral que torna a comparação possível: **o jsonb `itens` carrega por item, em 2.078
ocorrências, as chaves** `sequencia, codigoProduto, nomeProduto, unidade, quantidade, valorUnitario,
valorTotal, itemServico, cancelado, **classe**, **centroCusto**, **classeRateio**`. O jsonb tem o CC
do item; a tabela normalizada, não.

## Pedido 1 — `0003625` · multi-CC · nascido no Alvo

25/03/2026 · `criado_no_hub=false` · `valor_total = 48.379,82` · 1 item · **2 classes, 9 CCs distintos**

**Item (Alvo × Hub):** ✅ **bate campo a campo** — `sequencia 1`, `codigoProduto 002.023`,
`SERVIÇO DE HOSPEDAGEM`, `quantidade 1`, `valorUnitario 48.379,82`, `valorTotal 48.379,82`.
O mapeamento de itens do cron está correto.

**Rateio:** `linhas_rateio = 0` na tabela normalizada, contra **12 linhas** no payload. 🔴 O D1.

🔴 **Divergência de VALOR entre as duas fontes de rateio do Alvo** — o pedido da §4.3 ("relatar
divergências de valor, não só de ausência"). `classe_rateio` (cabeçalho, `PedCompClasseRecDespChildList`)
× `itens[].classeRateio` (item, `ItemPedCompClasseRecdespChildList`):

| linha | cabeçalho | item | Δ |
|---|---:|---:|---:|
| classe `15.01` — valor | 10.372,59 | 10.372,56 | **0,03** |
| classe `15.01` — percentual | 21,4399 | 21,4398 | 0,0001 |
| CC `00001.00001.00008` | 5.402,15 | 5.402,13 | 0,02 |
| CC `00001.00004.00001` (15.01) | 1.006,53 | 1.006,52 | 0,01 |
| classe `15.02` — valor | 38.007,23 | 38.007,26 | **0,03** |
| CC `00001.00001.00007` (15.02) | 1.318,89 | 1.318,86 | 0,03 |
| CC `00001.00003.00001` | 15.664,41 | 15.664,44 | 0,03 |
| CC `00001.00004.00001` (15.02) | 4.659,42 | 4.659,43 | 0,01 |
| CC `00001.00004.00004` | 16.364,51 | 16.364,53 | 0,02 |

**As duas fontes não batem ao centavo.** O escritor **A** lê a do item; o **C** prefere a do
cabeçalho. **O S1 precisa escolher qual é canônica** — e a escolha muda o número do relatório de
gasto por CC.

🔴 **`centro_custo` do cabeçalho é uma amostra enviesada.** Vale `00001.00001.00007` — que no rateio
real tem **3,0167%** da classe 15.01 e 3,4701% da 15.02, algo como **R$ 1.632 de R$ 48.380 (3,4%)**.
O CC com a maior fatia é `00001.00003.00001` (R$ 17.209, 35,6%). A coluna guarda a **primeira fatia
do primeiro rateio**, não o centro de custo do pedido.

**Dimensão do viés, medida:**

```sql
-- pedidos com rateio, contando CCs distintos por pedido
select count(*) com_rateio, count(*) filter (where ccs>1) multi_cc, max(ccs) …
```
| pedidos com rateio | **multi-CC reais** | % | **valor** | máx. CCs |
|---:|---:|---:|---:|---:|
| 1.179 | **83** | 7,0% | **R$ 1.407.857,06** | **10** |

Nos **83**, `centro_custo` está preenchido e aponta **um só** dos CCs.

> 🔴 **Isto corrige o `DISCOVERY-FASE7A.md` §C1.4.** A consulta de gasto por CC usa
> `centro_custo` do cabeçalho como 2ª fonte da cascata (14 pedidos de agosto, R$ 179.982,20).
> Para pedido multi-CC essa fonte **atribui 100% do valor a um CC que pode valer 3%**. Não invalida o
> total (R$ 1.642.742,28 continua reconciliando), mas **enviesa a distribuição**. Onde há rateio, o
> rateio manda; o cabeçalho só serve quando o pedido é mono-CC — e não há como saber qual é sem o rateio.

## Pedido 2 — `0004640` · CC só no cabeçalho · nascido no Alvo

11/08/2026 · `valor_total = 114.639,99` · `centro_custo = 00008.00001.00006` (LAB PESQUISA) ·
`classe_rec_desp = null` · `classe_rateio = []` · `itens` jsonb = `[]` · **2 itens normalizados** ·
`detalhes_carregados = true`.

Assinatura pura do defeito: o **Job 2 rodou** (itens gravados, flag marcada) e **nada do rateio ficou**.
O `centro_custo` que existe veio do **list** (Job 1), não do Load.

⚠️ **Este é o pedido que a §4.3 pediu e é justamente o que não dá para auditar sem Load ao vivo:**
sem snapshot do payload, não há como saber se o Alvo tem rateio para ele nem se
`00008.00001.00006` é o CC real ou só o do cabeçalho. **É o candidato natural para o primeiro Load de
validação do S1.**

## Pedido 3 — `0004269` · nascido no Hub (caminho suposto correto)

22/06/2026 · `criado_no_hub=true` · `valor_total = 49.653,47` · 1 item · **4 classes, 7 CCs, 10 linhas
de rateio normalizadas**. Soma dos percentuais: **100,00** ✅

| classe | centro de custo | % | valor derivado |
|---|---|---:|---:|
| 15.01 | 00007.00001.00005 | 7,85 | 3.897,80 |
| 15.01 | 00007.00004.00001 | 2,30 | 1.142,03 |
| 15.01 | 00010.00003.00001 | 2,15 | 1.067,55 |
| 15.02 | 00007.00001.00005 | 1,27 | 630,60 |
| 15.02 | 00007.00004.00001 | 7,27 | 3.609,81 |
| 15.02 | 00007.00004.00005 | 4,26 | 2.115,24 |
| 25.12 | 00008.00002.00001 | 1,84 | 913,62 |
| 25.12 | 00008.00002.00020 | 1,69 | 839,14 |
| 25.12 | 00010.00001.00001 | 6,77 | 3.361,54 |
| **25.13** | **00010.00001.00001** | **64,60** | **32.076,14** |

✅ O caminho do Hub funciona: rateio completo, normalizado, fechando 100%.

🔴 **Mas o mesmo viés aparece aqui:** `centro_custo` do cabeçalho = `00007.00001.00005`, que soma
**9,12%** (R$ 4.528,40). O CC dominante é `00010.00001.00001` com **71,37%** (R$ 35.437,68). **O
defeito do cabeçalho não é do sync — é da própria derivação `[0][0]`, e atinge também pedido nascido
no Hub.**

---

# §4.4 · Gate de saída e cobertura do prompt

| Item do prompt | Estado |
|---|---|
| S0-1 (prioridade) | ✅ medido — e **reverte a proposta da espec** |
| S0-2 · S0-3 · S0-4 · S0-5 | ✅ medidos |
| Matriz §4.2 | ✅ 40+ campos, com os 3 escritores |
| Prova de 3 pedidos §4.3 | ✅ com limite de evidência declarado (sem Load ao vivo) |
| Campos inexistentes no Hub / sem rota | ✅ declarados: valor do rateio · prazo do item · quem aprovou · binário de anexo |
| Nenhum código alterado, nenhuma escrita | ✅ MCP `read_only`; só `select` + 2 `GET` HTTP (`/health` e um Load recusado com 401) |

---

# Resumo executivo

1. **S0-1 muda de resposta.** A chave única não está só faltando — **ela não deve existir**. O domínio
   permite duas linhas com o mesmo (item, classe, CC), porque o Hub **achata** um percentual de duas
   camadas do Alvo numa só coluna. Há 1 caso real, e ele soma 100% corretamente. O caminho é
   **delete-then-insert por item**, que é o padrão que o wizard já usa (`limparFilhosDoPedido`).
   Zero DDL. **O §5-A da missão precisa ser reescrito.**
2. **Existe um terceiro loader**, `alvoPedCompLoadService.ts` (open-load do detalhe do pedido), mais
   completo que o que a espec elegeu como referência: cobre as duas fontes de rateio do Alvo e extrai
   anexos. **É a referência certa para o S1.**
3. **O Alvo tem duas fontes de rateio que divergem em centavos** (cabeçalho × item). Escolher a
   canônica é decisão de projeto, e muda o número do relatório por CC.
4. **Portar o achatamento como está quebraria a invariante de 100%** — simulado no `0003625`: 12
   linhas somam **100,02**.
5. **O D2 congela 11 campos**, não 2. E 9 campos nunca são escritos pelo cron.
6. **`centro_custo` do cabeçalho é a primeira fatia do primeiro rateio** — em 83 pedidos multi-CC
   (R$ 1,4 M) aponta um CC que pode valer 3% do pedido. Corrige a §C1 do `DISCOVERY-FASE7A.md`.
7. **O mapeamento de itens do cron está correto** — verificado campo a campo. O defeito é omissão do
   bloco de rateio, não valor errado.
8. **Anexos: metadado chega, binário não, e não há rota.**
9. **615 dos 616 afetados são de 2026** (R$ 6.640.908,54) — o recorte S3 quase não reduz o trabalho.
   **97 encerrados nunca mais serão visitados pelo cron**: é a justificativa do backfill.

# O que contradiz esta especificação

| # | A espec (`MISSAO-SYNC-PEDIDOS.md`) diz | O medido |
|---|---|---|
| 1 | §4.1-S0-1 / §5-A: criar `UNIQUE (item_id, classe, cc)` e fazer **upsert** por ela | ❌ A chave **proíbe um estado válido** (S0-1.b/c) e falharia hoje. Usar **delete-then-insert** |
| 2 | §5: "referência de implementação: `alvoPedCompService.ts:434-463`" | ⚠️ Existe um **terceiro** loader (`alvoPedCompLoadService.ts:130-149`), mais completo. É ele a referência |
| 3 | §5-A: mapear `ItemPedCompChildList[].ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[]` | ⚠️ Há **duas** fontes (`PedCompClasseRecDespChildList` no cabeçalho e a do item) e elas **divergem em centavos** |
| 4 | §4.2: rateio tem "percentual, valor" | ❌ **`valor` não existe** em `compras_pedidos_itens_rateio`. O Alvo manda; o Hub não guarda |
| 5 | §1.1-D2: "campo que veio vazio fica nulo para sempre" — cita `centro_custo` e `nome_entidade` | ⚠️ São **11 campos** congelados, e outros **9** nunca escritos pelo cron |
| 6 | §1.2: tabela de 8 campos degradados | ⚠️ Faltam `texto_historico`, `anexos` (jsonb) e a tabela `compras_pedidos_parcelas` inteira |
| 7 | §4.2: anexos — "se não existir suporte, dizer" | ⚠️ **Existe suporte parcial** e não declarado: metadado extraído e gravado em `compras_pedidos.anexos` (571 pedidos). Falta o binário e a rota |
| 8 | §6: "recalcular no S0 quantos dos 616 são 2026" | ✅ **615**. O recorte quase não reduz |
| 9 | §4.3: comparar o `Load` contra o Hub | ⚠️ Feito com **snapshot persistido**, não Load ao vivo (401 no gateway). Declarado |
| 10 | (implícito) `centro_custo` é o CC do pedido | 🔴 É a **primeira fatia do primeiro rateio**. 83 pedidos multi-CC, R$ 1,4 M, com cabeçalho enganoso — inclusive nascidos no Hub |

# Perguntas que só o Pedro pode responder

1. 🔴 **Qual rateio é canônico** — o do cabeçalho (`PedCompClasseRecDespChildList`) ou o do item
   (`ItemPedCompClasseRecdespChildList`)? Divergem em centavos e a escolha muda o relatório por CC.
   **Bloqueia o S1.**
2. 🔴 **Como resolver o achatamento do percentual** (soma dá 100,02): (a) aumentar as casas de
   `percentual`, (b) a última linha absorve o resíduo, (c) guardar as duas camadas (nova coluna
   `percentual_classe`), ou (d) guardar o **`Valor`** do Alvo numa coluna nova e parar de derivar por
   percentual. **Bloqueia o S1** e (c)/(d) são DDL.
3. **Adicionar coluna `valor` ao rateio?** O Alvo manda e hoje se perde. Com ela, o relatório por CC
   deixa de depender de percentual arredondado.
4. **O que fazer com `centro_custo` do cabeçalho**, agora que se sabe que é a primeira fatia:
   (a) manter como está, (b) parar de gravar quando houver rateio multi-CC, (c) renomear/anotar como
   "CC principal". Afeta a §C1 do `DISCOVERY-FASE7A.md`.
5. **A linha duplicada do `RASCUNHO-42c15eb8`** (2 × 25% na mesma classe+CC) — consolidar em uma de
   50% ou deixar? É rascunho, nunca foi ao Alvo. Só importa se você preferir o caminho do UNIQUE.
6. **`compras_pedidos_parcelas` entra no escopo?** A tabela normalizada nunca é populada pelo Alvo —
   mesmo defeito do rateio, e a espec só menciona o jsonb.
7. **Aposentadoria dos jsonb** (`classe_rateio`, `itens`, `anexos`, `parcelas`): quando? Hoje
   `ConfirmarLancamentoModal.tsx:295,340` e `VincularPedidoDialog.tsx:213,227` dependem deles.
8. **Os 2 pedidos `excluido_alvo`** (404 esperado no backfill): pular e logar, ou investigar?
9. **Pedido `0004495`** (`data_pedido = 25/08/2026`, futuro; itens somando R$ 110.000 contra
   `valor_total` R$ 55.000): dado correto ou erro de digitação no Alvo? Entra no fechamento de agosto.
10. **Anexos:** vale abrir rota de download no `erp-proxy` (outro repo, escopo novo), ou o metadado
    basta?
11. **"Quem aprovou no ERP"**: quer o campo? Não existe coluna no Hub e nenhum loader extrai — só um
    Load ao vivo diz se o payload traz.
12. **Um Load ao vivo para o `0004640`** fecharia o único buraco de evidência desta Discovery. Você
    consegue abrir o pedido no Hub e colar o JSON de `/ped-comp/1.01/0004640` (F12 → Network)?
