# DISCOVERY-SYNC-RATEIO-PEDIDOS.md — Fase S0 · **revisão 2 (03/09/2026)**

> Execução do **PROMPT S0** (`PROMPT-S0-SYNC-PEDIDOS.md` §4, que substitui a §4 da
> `MISSAO-SYNC-PEDIDOS.md`). Discovery, **100% leitura**: nenhuma alteração de código, nenhum SQL de
> escrita, nenhum deploy, nenhum push.
>
> ⚠️ **Este arquivo SUBSTITUI a versão de 14/08/2026**, commitada em `0dce7cb`. A anterior continua
> recuperável na íntegra: `git show 0dce7cb:DISCOVERY-SYNC-RATEIO-PEDIDOS.md`. Substituí em vez de
> criar um `-v2` porque o prompt pede este nome de arquivo; o histórico do git é o rollback.
> **Quase tudo que a v1 mediu mudou** — o motivo está na §A.

## 0. Protocolo de início de sessão (CLAUDE.md)

| Passo | Resultado |
|---|---|
| Prompt | **PROMPT S0 — Discovery da missão Sync de Pedidos** (rateio, cabeçalho, saúde do cron) |
| `git remote -v` | `https://github.com/financeiropfbrazil/finances-pf.git` ✅ |
| `git branch --show-current` | `main` |
| `git log -1 --oneline` | `c88bd2e docs(suprimentos): sql do ajuste 7.2 executado no banco` |
| `git pull origin main` | **Already up to date** — zero commits do Lovable |
| Projeto Supabase | `hbtggrbauguukewiknew` ✅ (MCP, confirmado por fingerprint) |

**Fingerprint (pré-voo, 03/09/2026 09h23 BRT):** `db=postgres` · `compras_pedidos = 2.017` ·
`compras_pedidos_itens = 3.495` · `compras_pedidos_itens_rateio = 863` · `compras_requisicoes = 392` ·
`intercompany_invoices_master_blocos = 210`.

Comparativo com o fingerprint da v1 (14/08): pedidos 1.863 → 2.017 · itens 2.600 → 3.495 ·
**rateio 139 → 863**. O salto do rateio é o primeiro sinal do achado da §A.

---

# §A · O achado que reordena a missão: **a FASE S1 já foi executada**

O `PROMPT-S0-SYNC-PEDIDOS.md` é datado de 03/09/2026, mas descreve o mundo de **14/08**. Entre uma
data e outra entraram **114 commits**, e quatro deles são exatamente a correção que a §5 do prompt
pede como trabalho futuro:

| Commit | Data | O que fez |
|---|---|---|
| `050e88f` | 20/08 | **feat(compras): cron grava rateio por item, parcelas e completa cabeçalho — card C3** (+366 linhas) |
| `105e1fb` | 20/08 | fix: percentual de classe única ausente + gate de reprocesso — card C3.2 |
| `d767457` | 24/08 | fix: normalização de rateio — null≠zero, tolerância e reconstrução por valor — card C3.3 |
| `ff1dd86` / `7d7afb1` | 27–28/08 | consolidação de (classe, CC) repetido — card D4 |

**Está em produção.** A Edge Function publicada contém `sync_replace_filhos_pedido`,
`extrairRateiosDoItem`, `completarCamposAusentes` e `percentual_classe`. E o banco mostra o efeito:

| | v1 (14/08) | hoje (03/09) |
|---|---:|---:|
| Linhas de rateio | 139 | **863** |
| Linhas de rateio em pedido nascido no **Alvo** | 6 | **652** |
| Pedidos nascidos no Alvo com rateio normalizado | 4 | **269** |

O banco também ganhou o que a v1 pediu: **`compras_pedidos_itens_rateio.valor`** e
**`valor_derivado`** (pergunta 3 da v1, respondida), e **`compras_pedidos_parcelas` ganhou
`UNIQUE (pedido_id, sequencia)`**.

> 🔴 **Consequência para o plano:** a §5 (FASE S1) do prompt está, no essencial, **concluída**. O que
> resta não é "portar o mapeamento" — é (a) um **resíduo do D1 ainda vivo**, mensurável, que a
> correção não alcança (§S0-5), e (b) o backfill (§S2), que ficou **muito mais barato** do que a
> espec supõe (§S0-5.c). O S5 ("corrigir primeiro, backfill depois") já está satisfeito.

---

# S0-1 · ⚠️ CRÍTICO — chave única de `compras_pedidos_itens_rateio`

## Veredito: **continua sem UNIQUE de negócio — e continua certo assim.** O caminho adotado foi outro.

### S0-1.a O estado do schema, hoje

```sql
select 'index', indexname, indexdef from pg_indexes where tablename='compras_pedidos_itens_rateio'
union all select 'constraint', conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid='public.compras_pedidos_itens_rateio'::regclass;
```

| tipo | nome | definição |
|---|---|---|
| constraint | `compras_pedidos_itens_rateio_pkey` | `PRIMARY KEY (id)` — sintética |
| constraint | `compras_pedidos_itens_rateio_item_id_fkey` | `FOREIGN KEY (item_id) → compras_pedidos_itens(id) ON DELETE CASCADE` |
| index | `compras_pedidos_itens_rateio_pkey` | `UNIQUE (id)` |
| index | `idx_compras_pedidos_itens_rateio_item_id` | `btree (item_id)` — **não único** |

**Nenhum UNIQUE de negócio.** Idêntico ao medido em 14/08.

### S0-1.b As duplicatas sumiram

```sql
select item_id, codigo_classe_rec_desp, codigo_centro_ctrl, count(*) from … group by 1,2,3 having count(*)>1;
```
→ **0 grupos, 0 linhas excedentes** (em 14/08 havia 1 grupo / 1 excedente, no `RASCUNHO-42c15eb8`).
Resolvido pelos cards `653fe8d` (o wizard recusa linha em branco/duplicada) e `ff1dd86`/`7d7afb1`
(consolidação de (classe, CC) repetido).

### S0-1.c O caminho que a implementação seguiu — e por que a chave continua sem sentido

A RPC `sync_replace_filhos_pedido` (SECURITY DEFINER, `search_path=public`) faz
**delete-then-insert por pedido** — exatamente a recomendação S0-1.e da v1:

```sql
delete from compras_pedidos_itens_rateio r
using compras_pedidos_itens i
where i.id = r.item_id and i.pedido_id = p_pedido_id;
```

Idempotente sem chave nenhuma, tolera repetição legítima, zero DDL. **Não criar o índice.**

> **Isto confirma a v1 e continua contradizendo a espec:** `MISSAO-SYNC-PEDIDOS.md` §4.1-S0-1 e §5-A
> pedem "upsert pela chave única do S0-1". A chave não existe, não deve existir, e a implementação
> que foi ao ar não a usou.

---

# S0-2 · Estrutura real das tabelas (o que mudou desde a v1)

### `compras_pedidos_itens_rateio` — **863 linhas · 796 itens · 10 colunas** (eram 8)

| # | coluna | tipo | nulo? | novidade |
|---|---|---|---|---|
| 1 | `id` | uuid PK `gen_random_uuid()` | não | |
| 2 | `item_id` | uuid → FK CASCADE | não | |
| 3 | `codigo_classe_rec_desp` | text | não | |
| 4 | `classe_rec_desp_label` | text | sim | |
| 5 | `codigo_centro_ctrl` | text | não | |
| 6 | `centro_ctrl_label` | text | sim | |
| 7 | `percentual` | numeric | não | 🔴 **duas convenções** — ver S0-3 |
| 8 | `created_at` | timestamptz `now()` | não | |
| 9 | **`valor`** | numeric | **sim** | 🆕 pergunta 3 da v1, respondida |
| 10 | **`valor_derivado`** | boolean `false` | não | 🆕 marca valor calculado, não recebido |

Preenchimento: **716 linhas com `valor`** · **57 com `valor_derivado=true`** · 147 com `valor` nulo
(são as do wizard do Hub, que não grava valor).
🔴 **Continua não existindo `percentual_classe`** — a fatia da classe **só sobrevive dentro de `valor`**.
Continua não existindo `sequencia` nem `updated_at`.

### `compras_pedidos_itens` — 3.495 linhas, 15 colunas
Inalterada. **`UNIQUE (pedido_id, sequencia)`** ✅ (o upsert de itens é seguro).
Sem coluna de centro de custo, classe, ou prazo/entrega do item.

### `compras_pedidos_parcelas` — 9 colunas
🆕 **ganhou `UNIQUE (pedido_id, sequencia)`** — a v1 registrou a ausência como risco; foi fechado.
A RPC usa `delete` + `insert … on conflict (pedido_id, sequencia) do nothing`.

### `compras_pedidos` — 2.017 linhas · **63 colunas** (eram 61)
PK `id` · `UNIQUE (codigo_empresa_filial, numero)` · FK `criado_por_user_id → auth.users`.
**Uma única CHECK constraint em toda a família** (regra 4):

```sql
compras_pedidos_vinculo_requisicao_check
  CHECK (vinculo_requisicao = ANY (ARRAY['com_vinculo','sem_vinculo','nao_verificado']))
```

`status_local` é enum (`public.compras_pedido_status_local`) — valor novo exige `ALTER TYPE` antes.
`status`, `aprovado`, `comprado`, `tipo`, `status_aprovacao` são `text` **sem CHECK**.
Colunas novas desde a v1: `codigo_ind_economico`, `valor_cambio` (card MOEDA-PEDIDOS A2).

---

# S0-3 · O rateio fecha 100%? · 🔴 **A invariante mudou de forma — e a coluna ganhou duas semânticas**

```sql
select round(sum(percentual),4), count(*) from (…) group by item_id;
```

| | |
|---|---:|
| Itens com rateio | **796** |
| Itens cuja soma de `percentual` = 100,0000 | **794** |
| Itens que **não** fecham | **2** |
| Soma máxima observada | **400,0000** |

Os dois casos:

| pedido | nascido no | data | classes no item | linhas | soma |
|---|---|---|---:|---:|---:|
| `0004691` | Alvo | 18/08/2026 | 4 | 11 | **400,0000** |
| `0004667` | Alvo | 13/08/2026 | 2 | 13 | **200,0000** |

**Não é corrupção — é convenção.** `extrairRateiosDoItem` (`index.ts:1651`) grava, por decisão
explícita do card C3-C, *"uma linha por (item, classe, CC) com o percentual **do próprio nível** —
nunca o produto dos dois, porque o produto arredondado é a origem do 100,02% medido no `0003625`"*.
Ou seja: o defeito de arredondamento que a v1 previu foi evitado — trocando-se a invariante.

## 🔴 A coluna `percentual` tem hoje DUAS convenções

| Escritor | `percentual` guarda | soma por item | `valor` |
|---|---|---|---|
| Wizard do Hub (`pedidosService.ts`, `enviarPedido`) | **absoluto** — fatia do item (`classe% × cc% / 100`) | 100 | **null** |
| RPC `sync_replace_filhos_pedido` (espelho do Alvo) | **relativo à classe** | **100 × nº de classes** | preenchido |

É o padrão **LIVRO × ESPELHO** do CLAUDE.md, dentro de uma única coluna. O efeito já se manifestou em
produção e já foi corrigido no leitor: `montarRateioDoItem` (`pedidosService.ts:918-1080`) discrimina
pelo `valor` (`ehEspelho = toda linha tem valor`) e, para linha de espelho, **deriva a fatia da classe
pelos VALORES**, não pela soma de percentuais. O comentário no código registra o incidente:
*"Medido em 27/08/2026: `0004691` (4 classes) aparecia como R$ 189.378,20 em vez de R$ 47.344,55, e
`0004667` (2 classes) dobrado — R$ 191.230,91 de valor fantasma."*

> ⚠️ **Dívida estrutural, não fechada:** a semântica de `percentual` **não é declarada em lugar nenhum
> do schema** — nem coluna, nem CHECK, nem comentário. O único discriminador é `valor is not null`, e
> ele é implícito. Qualquer consulta nova que faça `sum(percentual)` ou `valor_total × percentual/100`
> sobre linha de espelho erra por um fator igual ao número de classes. **É o candidato número 1 a
> repetir o incidente.**

---

# S0-4 · O D2 (campo gravado uma vez, nunca completado) — **em grande parte fechado**

O `if (existingPed) { … continue; }` **continua existindo** (hoje no **Job 3**, `index.ts:1401`, não
mais no "Job 1": a numeração dos jobs mudou). O que mudou é que ele deixou de ser a única defesa:
`completarCamposAusentes` (`index.ts:1910`) roda **em todo ciclo, para todo pedido candidato**, e
preenche o que estiver vazio — *"vazio" inclui `[]`*, e ela **nunca sobrescreve** valor existente.

| Campo | v1 (14/08): congelado? | hoje |
|---|---|---|
| `centro_custo` | ❌ congelado | ✅ completado quando nulo (`rateios[0].cc`) |
| `nome_entidade` | ❌ congelado (caso `0004664`) | ✅ completado, com fallback em `compras_entidades_cache` |
| `cnpj_entidade` | 🔴 nunca escrito | ✅ completado, mesmo fallback |
| `nome_cond_pag` | 🔴 nunca escrito | ✅ completado |
| `primeiro_vencimento` | 🔴 nunca escrito | ✅ derivado das parcelas |
| `classe_rec_desp` | 🔴 nunca escrito | ✅ completado (`rateios[0].classe`) |
| `classe_rateio`, `itens`, `parcelas` (jsonb) | 🔴 nunca escritos | ✅ dual-write na transição (decisão S1) |
| `codigo_ind_economico`, `valor_cambio` | não existiam | ✅ completados |

**Continuam congelados na primeira descoberta** (Job 3 grava, Job 2 nunca revisita): `tipo`,
`data_pedido`, `data_cadastro`, `data_entrega`, `data_validade`, `codigo_entidade`,
`codigo_cond_pag`, `codigo_usuario`, `texto`. São **9**, não 11 — e todos estão saudáveis
(`codigo_usuario` 2.017/2.017 · `texto` 1.975/2.017 · `data_validade` 2.000/2.017).

**Continuam nunca escritos pelo cron:** `texto_historico` (139/2.017 — só o loader antigo escreveu) e
`anexos` (jsonb) — ver §4.2 · Anexos.

⚠️ **O caso `0004664`** (R$ 110.000 sem fornecedor, motivador do D2): hoje tem `nome_entidade`
preenchido, 1 item e 1 linha de rateio. **Resolvido.**

---

# S0-5 · O filtro do Job 2, o alcance real e 🔴 **o resíduo do D1 que continua vivo**

### S0-5.a A fila, como o código a define (`index.ts:2130-2161`)

```ts
.or('and(status.not.in.("Encerrado","Cancelado","Cancelado Parcial")),and(detalhes_carregados.not.is.true)')
.or("status_local.is.null,status_local.neq.excluido_alvo")
.or(`data_pedido.gte.${hoje-180d},status_aprovacao.in.("Em Andamento","Reavaliar")`)
.order("synced_at", { ascending: true, nullsFirst: true })
.limit(100)
```

Três `.or()` encadeados = **AND** entre eles. Ordenação por `synced_at` ascendente ⇒ **rodízio real**,
o mais antigo primeiro; não há inanição de cauda.

### S0-5.b O gate de reprocesso — e o falso-positivo que ele carrega

```ts
const filhosAusentes = jsonbAusente(ped.classe_rateio) || jsonbAusente(ped.parcelas) || jsonbAusente(ped.itens);
if (ped.detalhes_carregados !== true || filhosAusentes) { await persistirItensPedido(…) }
```

Os três jsonb são o **proxy** que decide se os filhos relacionais estão faltando. Na **geração antiga**
(pré-24/05) esse proxy é **falso-positivo**: o loader antigo populou os três jsonb, mas a tabela
normalizada de rateio nem existia como destino do sync. Logo `filhosAusentes = false`,
`detalhes_carregados = true` — e `persistirItensPedido` **nunca roda**.

**Medido, com a elegibilidade replicada em SQL:**

| grupo | pedidos sem rateio normalizado (mas com rateio no jsonb) | valor |
|---|---:|---:|
| 🔴 **Elegíveis ao Job 2, mas barrados pelo gate** (`detalhes_carregados=true` e proxy diz "completo") | **121** | **R$ 1.809.107,94** |
| Fora da fila do Job 2 (terminal + carregado, ou fora do corte de 180 d) | **1.053** | **R$ 10.381.241,70** |
| **Total** | **1.174** | **R$ 12.190.349,64** |

Dos 1.174, **922 são de 2026** (recorte S3) — 120 dos elegíveis e 802 dos não elegíveis.

> 🔴 **Os 121 são o resíduo do D1 ainda vivo.** O cron os visita ~2,4×/dia (fila de 421, 100 por
> execução, 10 execuções/dia) e **pula o rateio em todas**. Nenhum deles se resolve sozinho, por mais
> que se espere. Diferente dos 1.053, que a espec já sabia que precisariam de backfill, **estes 121 a
> espec supõe que o S1 resolveria — e não resolve.**

### S0-5.c 💡 O backfill não precisa do Alvo

```sql
-- dos 1.174 sem rateio normalizado, quantos já têm o rateio por item no jsonb `itens`?
```
| | |
|---|---:|
| Pedidos sem rateio normalizado | **1.174** |
| …com o rateio por item **já persistido** em `itens[].classeRateio` | **1.173** |
| …só com o rateio de cabeçalho (`classe_rateio`) | 1 |
| …sem itens normalizados (precisam de carga de item) | 77 |

**1.173 de 1.174 podem ser reconstruídos em SQL puro, a partir de payload que já está no banco.**
Isso muda a §6 do prompt de ponta a ponta: nada de "lotes de ~25 Loads com pausa, fora das janelas do
cron". Sem chamada ao gateway, o backfill **não compete com o Job 2**, não depende de janela, e o
achado do S0-6 deixa de ser restrição.
⚠️ **Limite:** o jsonb é um **instantâneo** de quando o Load rodou, não o estado de agora. Para pedido
vivo, o cron corrige depois; para terminal, o instantâneo é a melhor evidência disponível — e é a
mesma que a tela já exibe hoje.

### S0-5.d Cobertura, hoje

Por coorte de descoberta (o corte da espec):

| coorte | pedidos | rateio norm. | `centro_custo` | `classe_rec_desp` | `cnpj` | `nome_cond_pag` |
|---|---:|---:|---:|---:|---:|---:|
| Antes de 24/05 (loader antigo) | 1.061 | **0,1%** | 99,3% | 99,6% | 96,4% | 82,5% |
| Depois de 24/05 (cron) | 956 | **42,1%** | 62,2% | 52,4% | 42,9% | 54,5% |

⚠️ **Cuidado com esta tabela** — ela mede coorte, não saúde do fluxo. A coorte antiga tem 0,1% de
rateio normalizado porque a tabela normalizada não era destino do sync na época, não porque piorou.
A leitura útil é **por mês de descoberta, só pedidos nascidos no Alvo**:

| mês desc. | peds | rateio norm. | parcelas norm. | `centro_custo` | `classe` | `cnpj` | `cond_pag` | `1º venc.` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-03 | 901 | 0% | 0% | 100% | 100% | 97% | 84% | 99% |
| 2026-04 | 61 | 0% | 0% | 100% | 100% | 97% | 31% | 100% |
| 2026-05 | 165 | 10% | 10% | 79% | 79% | 68% | 79% | 79% |
| 2026-06 | 408 | 18% | 18% | 47% | 30% | 20% | 30% | 30% |
| 2026-07 | 189 | 34% | 32% | 61% | 53% | 34% | 53% | 52% |
| **2026-08** | 133 | **72%** | 70% | **83%** | 81% | 74% | 81% | 79% |
| **2026-09** | 25 | **72%** | 68% | **96%** | 80% | 68% | 80% | 76% |

A curva sobe de 18% (jun) para 72% (ago/set) — a correção **funciona e é visível**. Mas **não chega a
99%**, e o teto tem nome: os 121 barrados pelo gate, distribuídos justamente nos meses em que o
loader antigo já havia populado os jsonb.

### S0-5.e O que isso significa para o objetivo da missão

```sql
-- pedidos de 2026, por presença de rateio normalizado
```
| situação | pedidos | valor | % do valor |
|---|---:|---:|---:|
| **com** rateio normalizado | 403 | R$ 4.033.581,14 | 21,5% |
| **sem** rateio normalizado | 1.361 | **R$ 14.763.599,73** | **78,5%** |

🔴 E a RPC `listar_pedidos_escopo` — o escopo do líder de centro de custo, entregue **ontem**
(AJUSTE 7.2, `8bd95e1`) — lê **as duas** fontes: `compras_pedidos_itens_rateio` **e**
`p.centro_custo`. Com 78,5% do valor de 2026 sem rateio normalizado, **o escopo do líder hoje se
apoia majoritariamente no cabeçalho**, que é a *primeira fatia do primeiro rateio* (o próprio código
avisa, em `index.ts:1955`: *"esta coluna guarda a PRIMEIRA fatia do rateio, nunca o CC do pedido.
Nenhuma visão de gasto por centro de custo pode ler daqui"*). O backfill não é higiene de dados —
**é o que faz o AJUSTE 7.2 mostrar o número certo.**

---

# §4.2 · Matriz de conformidade campo a campo

## Os escritores (hoje são quatro)

| # | Escritor | Onde | Gatilho | Fonte |
|---|---|---|---|---|
| **A** | `syncPedidosCompra` | `src/services/alvoPedCompService.ts:240-490` | botão manual em `/compras/pedidos-compra` | `list` + `Load` |
| **B3** | Job 3 — descoberta | `supabase/functions/sync-compras-status-cron/index.ts:1260` | pg_cron | `list` (leve) |
| **B2** | Job 2 — mudanças + C3 | mesmo arquivo, `:2109` (`persistirItensPedido` `:1823`, `completarCamposAusentes` `:1910`) | pg_cron | `Load` |
| **C** | `carregarDetalhesPedido` | `src/services/alvoPedCompLoadService.ts:327-400` | open-load do detalhe, a cada abertura | `Load` |
| **RPC** | `sync_replace_filhos_pedido` | banco, SECURITY DEFINER | chamada por **B2** | payload já extraído |

## Cabeçalho

| Campo no Hub | Origem no Alvo | Quem escreve hoje | Cobertura | Veredito |
|---|---|---|---:|---|
| `numero`, `codigo_empresa_filial` | `Numero`, `CodigoEmpresaFilial` (list) | A, B3 | 100% | ✅ |
| `status`, `aprovado`, `status_aprovacao`, `comprado` | idem (list e Load) | A, B3, **B2**, C | 100% | ✅ |
| `tipo` | 🔴 **não é `ped.Tipo`** — derivado de `ValorMercadoria`/`ValorServico` | A, B3 | — | ⚠️ congelado; corrigido em `ab0e0f3` (o `Tipo` do Alvo é tipo de ENTREGA, não natureza) |
| `codigo_entidade` | `CodigoEntidade` | A, B3 | 100% | ⚠️ congelado, saudável |
| `nome_entidade` | `NomeEntidade` + fallback `compras_entidades_cache` | A, B3, **B2** | 99% | ✅ **corrigido** (era o `0004664`) |
| `cnpj_entidade` | `CPFCNPJ` + mesmo fallback | A, **B2** | 43→74% (ago) | ✅ **corrigido**, subindo |
| `centro_custo` | ⚠️ **duas origens** — `ped.CodigoCentroCtrl` (B3, do list) ou `rateios[0].cc` (B2) | A, B3, **B2** | 83–96% (ago/set) | ⚠️ **semanticamente enganoso** — é a 1ª fatia; o código avisa |
| `classe_rec_desp` | `rateios[0].classe` | A, **B2** | 81% (ago) | ✅ corrigido |
| `classe_rateio` (jsonb) | cabeçalho `PedCompClasseRecDespChildList`, fallback item | A, C, **B2** | 81% (ago) | ✅ dual-write (S1) |
| `itens` / `parcelas` (jsonb) | `ItemPedCompChildList` / `ParcPagPedCompChildList` | A, C, **B2** | 81% / 79% | ✅ dual-write (S1) |
| `primeiro_vencimento` | menor `DataVencimento` das parcelas | A, C, **B2** | 79% | ✅ corrigido |
| `codigo_cond_pag` | `CondPagPedCompObject.CodigoCondPag` (list) | A, B3 | — | ⚠️ congelado, saudável |
| `nome_cond_pag` | `CondPagPedCompObject.Nome` (**só no Load**) | A, C, **B2** | 81% (ago) | ✅ corrigido |
| datas (`data_pedido`, `_cadastro`, `_entrega`, `_validade`) | list | A, B3 | 94–99% | ⚠️ congeladas, saudáveis |
| `data_digitacao_alvo`, `data_aprovacao_alvo` | `DataHoraDigitacao`, `extrairDataAprovacaoAlvo` | B3, **B2**, C | — | ✅ |
| `codigo_ind_economico`, `valor_cambio` (moeda) | `CodigoIndEconomico`, `ValorCambio` (**só Load**) | **B2**, C | 904 / 1.066 de 2.017 | ✅ backfill incremental; null é resposta legítima do Alvo |
| vínculo com requisição (`numero_req_comp`, `vinculo_requisicao`, `req_comp_itens`) | `extrairVinculoRequisicao` | B3 (list, só afirma presença), **B2** (Load, afirma os dois) | — | ✅ |
| `texto` (observação do cabeçalho) | `Texto` (list) | A, B3 | 1.975/2.017 | ⚠️ congelado, saudável |
| **`texto_historico`** | `TextoHistorico` (**só no Load**) | **só A** | **139/2.017** | 🔴 **nunca escrito pelo cron** |
| `codigo_usuario` (comprador no Alvo) | `CodigoUsuario` | A, B3 | 2.017/2.017 | ⚠️ congelado, saudável |
| `proximo_aprovador`, `enviou_aprovacao`, `data_notificacao_aprovador` | `PedCompUserFieldsObject.User*` | A, B3, **B2**, C | — | ✅ |
| **quem aprovou no ERP** | — | **ninguém** | — | 🔴 **não existe coluna no Hub.** Nenhum dos quatro escritores extrai identidade de aprovador — só `UserProximoAprovador`, que é o **próximo**, não quem aprovou. Se o payload traz, só um Load ao vivo diz |

## Valores (regra 11 — medir, não corrigir)

| Campo | Origem | Quem escreve | Veredito |
|---|---|---|---|
| `valor_total` | `resolverValorTotalAlvo` (cabeçalho; fallback soma de itens) | A, B3, **B2**, C | ✅ |
| `valor_mercadoria`, `valor_servico`, `valor_frete` | campos homônimos | A, B3, **B2**, C | ✅ |
| `valor_desconto` (`ValorDescontoGeral`), `valor_outras_despesas`, `valor_ipi` (`GeralValorIPI`) | Load | A, **B2**, C | ✅ |

Os 7 continuam sendo o que o cron faz certo. ⚠️ **A soma dos itens continua não reconciliando com o
cabeçalho** em alguns pedidos — medido de novo no `0004495` (§4.3). O cabeçalho é a fonte da verdade;
a espec manda não tocar, e não toquei.

## Itens

| Campo no Hub | Origem (`ItemPedCompChildList[]`) | Quem escreve | Veredito |
|---|---|---|---|
| `sequencia`, `item_servico`, `codigo_produto`, `codigo_alternativo_produto`, `codigo_prod_unid_med`, `produto_nome`, `produto_unidade`, `quantidade`, `valor_unitario`, `valor_total_item`, `observacao` | campos homônimos do Alvo | **B2** (`persistirItensPedido`, upsert por `(pedido_id, sequencia)`) | ✅ mapeamento correto e completo — reconferido campo a campo no §4.3 |
| item cancelado | `Cancelado`; `'Total'` é **pulado**, `'Parcial'` é gravado | **B2** | ✅ por design |
| **prazo / data de entrega do item** | — | — | 🔴 **não existe coluna no Hub.** Achado, não omissão |
| **centro de custo do item** | `ItemPedCompClasseRecdespChildList[]` | **B2 → RPC** | ✅ **era o D1; hoje é gravado** (resíduo em S0-5.b) |

## Rateio

| Campo no Hub | Origem no Alvo | Quem escreve | Veredito |
|---|---|---|---|
| `codigo_classe_rec_desp` | `ItemPedCompClasseRecdespChildList[].CodigoClasseRecDesp` | wizard **e** RPC | ✅ |
| `classe_rec_desp_label` | **não vem no payload** — `carregarCatalogosLabels` busca em `classes_rec_desp` | wizard e RPC | ✅ enriquecido localmente |
| `codigo_centro_ctrl` | `…RateioItemPedCompChildList[].CodigoCentroCtrl` | wizard e RPC | ✅ |
| `centro_ctrl_label` | **não vem no payload** — busca em `cost_centers.erp_code/name` | wizard e RPC | ✅ |
| `percentual` | `Percentual` do nível | ambos | 🔴 **duas convenções** (S0-3) |
| **`valor`** | `Valor` do CC | **só a RPC** | ✅ 🆕 coluna criada; null no wizard |
| `valor_derivado` | — | RPC | ✅ 🆕 marca o valor calculado quando o Alvo omitiu |
| fonte do rateio | 🔴 **só a do ITEM** (`ItemPedCompClasseRecdespChildList`) | RPC | ⚠️ o Alvo tem **duas** (cabeçalho e item) e elas divergem em centavos — o cabeçalho ficou só no jsonb de compatibilidade |

## Parcelas

| Camada | Situação |
|---|---|
| `compras_pedidos.parcelas` (jsonb) | ✅ dual-write por **B2**, além de A e C |
| `compras_pedidos_parcelas` (normalizada) | ✅ **agora populada pelo Alvo** (RPC) — era 🔴 na v1. `UNIQUE (pedido_id, sequencia)` criado. Parcela sem `data_vencimento` é descartada **com aviso** (`PARCELA_SEM_VENCIMENTO_DESCARTADA`), não em silêncio |

## Anexos — **metadado sim, binário não, rota não** (inalterado desde a v1)

| Camada | Situação |
|---|---|
| Payload do Alvo | ✅ traz `PedCompArquivoChildList[]` (`Sequencia`, `Arquivo` = caminho no servidor, `CodigoUsuario`, `DataArquivo`, `Observacao`) |
| Extração | ✅ `extrairAnexos` (`alvoPedCompLoadService.ts:190`) — **escritor C apenas** |
| No Hub | `compras_pedidos.anexos` (jsonb) — **642 pedidos com ao menos um anexo** |
| **Cron** | 🔴 **não escreve `anexos`** — zero ocorrências de `anexos`/`PedCompArquivo` em `sync-compras-status-cron/index.ts`. **Ficou de fora do card C3** |
| Binário do arquivo | 🔴 **não chega.** Só o caminho (`\\servidor\…`) |
| Rota no gateway | 🔴 **não existe.** Rotas de pedido no repo: `GET /ped-comp/{filial}/{numero}`, `POST /ped-comp/insert`, `/ped-comp/insert-multipart`, `/ped-comp/update`, `/ped-comp/atualiza-item-pedido`. A única multipart é de **envio** |
| `compras_pedidos_arquivos` | tabela **do Hub**, não espelho — upload do wizard para o Supabase Storage |

> **Resposta explícita à §4.2:** o metadado de anexo chega e é gravado — **mas só pelo open-load, que
> depende de alguém abrir o pedido na tela**. O cron não escreve. O binário não chega e **não há
> rota**. Baixar anexo do Alvo é funcionalidade nova no `erp-proxy` (outro repo), fora do escopo.

---

# §4.3 · Prova de fogo — 3 pedidos comparados campo a campo

## ⚠️ Limite da evidência, declarado

**Não foi feito `Load` ao vivo.** O `erp-proxy` exige JWT de usuário; a chave anon devolve 401. Usei o
**payload persistido** (`compras_pedidos.itens`, gravado pelo próprio Load) confrontado contra as
tabelas normalizadas. Como o jsonb e a tabela são escritos **na mesma transação lógica, do mesmo
payload**, a comparação é forte para detectar erro de mapeamento — e é cega para deriva posterior no
Alvo.

## Pedido 1 — `0004691` · multi-classe · nascido no Alvo · **escrito pelo cron**

18/08/2026 · `Encerrado` · `valor_total = 47.344,55` · 1 item · **4 classes, 9 CCs, 11 linhas**

| classe | centro de custo | payload %classe | payload %CC | payload valor | Hub `percentual` | Hub `valor` | Δ |
|---|---|---:|---:|---:|---:|---:|---:|
| 15.01 | 00007.00001.00004 | 6,7879 | 11,1106 | 357,06 | 11,1106 | 357,06 | **0,00** |
| 15.01 | 00010.00002.00001 | 6,7879 | 88,8894 | 2.856,64 | 88,8894 | 2.856,64 | **0,00** |
| 15.02 | 00007.00001.00003 | 87,4733 | 1,9465 | 806,13 | 1,9465 | 806,13 | **0,00** |
| 15.02 | 00007.00001.00004 | 87,4733 | 8,4229 | 3.488,26 | 8,4229 | 3.488,26 | **0,00** |
| 15.02 | 00007.00002.00001 | 87,4733 | 13,2093 | 5.470,48 | 13,2093 | 5.470,48 | **0,00** |
| 15.02 | 00007.00004.00001 | 87,4733 | 2,2693 | 939,80 | 2,2693 | 939,80 | **0,00** |
| 15.02 | 00007.00004.00003 | 87,4733 | 3,9092 | 1.618,96 | 3,9092 | 1.618,96 | **0,00** |
| 15.02 | 00007.00006.00001 | 87,4733 | 68,5532 | 28.390,54 | 68,5532 | 28.390,54 | **0,00** |
| 15.02 | 00010.00004.00002 | 87,4733 | 1,6895 | 699,69 | **1,6896** | 699,69 | **0,00** |
| 15.06 | 00007.00006.00001 | 0,6988 | 100 | 330,86 | 100,0000 | 330,86 | **0,00** |
| 25.13 | 00008.00002.00002 | 5,0399 | 100 | 2.386,11 | 100,0000 | 2.386,11 | **0,00** |

✅ **Zero divergência de valor.** A única diferença — `1,6895 → 1,6896` — é a RPC absorvendo o resíduo
na última linha da classe para fechar 100,0000 exatos, deliberadamente.
Soma dos valores: **R$ 47.344,53** contra `valor_total` **R$ 47.344,55** — **2 centavos**, porque o
rateio do Alvo é contra `ValorTotal + ValorIPI` do item, não contra o total do cabeçalho.
🔴 Este é um dos dois itens cuja soma de `percentual` dá **400** (S0-3): quatro classes × 100.

## Pedido 2 — `0003625` · coorte antiga · **o caso do backfill**

25/03/2026 · `Encerrado` · `valor_total = 48.379,82` · 1 item · `detalhes_carregados = true`

| | |
|---|---:|
| Linhas no payload persistido (`itens[].classeRateio`) | **12** |
| Soma dos valores no payload | **R$ 48.379,82** — bate ao centavo com o cabeçalho |
| Linhas na tabela normalizada | **0** |

Assinatura exata do resíduo: o rateio **está no Hub**, em jsonb, completo e reconciliando — e **não
está** na tabela que as visões por centro de custo leem. Fora da fila do Job 2 (terminal + carregado),
não se resolve sozinho. **É a prova de que o backfill por SQL é suficiente: o dado já está aqui.**

## Pedido 3 — `0004269` · nascido no Hub (caminho suposto correto)

22/06/2026 · `criado_no_hub = true` · `valor_total = 49.653,47` · 4 classes, 7 CCs, **10 linhas**

| | |
|---|---:|
| Soma de `percentual` | **100,0000** ✅ (convenção do wizard: absoluto) |
| Linhas com `valor` | **0** — o wizard não grava valor |
| Linhas no payload | 10 · soma dos valores **R$ 49.653,48** (1 centavo do cabeçalho) |

✅ O caminho do Hub funciona. 🔴 E exibe, lado a lado com o Pedido 1, **as duas convenções da mesma
coluna**: 10 linhas somando 100 e sem valor (wizard) contra 11 linhas somando 400 e com valor (espelho).

## Achado extra — `0004495` (pergunta aberta da §4.5)

25/08/2026 · `criado_no_hub = true` · `Aberto` · `valor_total = 55.000,00` (todo em `valor_servico`)

| item | produto | quantidade | valor unitário | `valor_total_item` | qtd × unit |
|---:|---|---:|---:|---:|---:|
| 1 | 002.057 | **2** | 55.000,00 | **110.000,00** | 110.000,00 |

O item é internamente consistente (2 × 55.000 = 110.000); o **cabeçalho** é que diz 55.000. Como o
pedido **nasceu no Hub**, ou a quantidade foi digitada como 2 devendo ser 1, ou o cabeçalho no Alvo
está errado. **Não é defeito de sync** — é dado. Só o Pedro decide.

---

# §4.4 · Saúde do cron `bicephalous` (frente nova)

## S0-6 — A fila do Job 2: **estável, com leve queda. Não está crescendo.**

Série extraída de `sync_runs.observacao` (`Job2 elegíveis(sem limit)=N, limit=100`):

| data | fila (mín–máx no dia) |
|---|---|
| 26/08 | 421 – 434 |
| 27/08 | 436 – 439 |
| 28/08 | 436 – **440** |
| 31/08 | 429 – 433 |
| 01/09 | 415 – 432 |
| 02/09 | 420 – 427 |
| **03/09** | **421 – 422** |

**De ~440 para ~421 em 7 dias úteis (≈ −2,7/dia).** A preocupação do prompt ("435 na fila, 100 por
execução") não se confirma, e o motivo é aritmético: **10 execuções/dia × 100 = 1.000 visitas/dia
contra ~421 elegíveis ⇒ cada elegível é visitado ~2,4×/dia.** Com `order by synced_at asc`, o rodízio
é completo. A "fila" não é um backlog de não processados — é a **população elegível**, que gira.

⚠️ **Mas isso não é boa notícia para o resíduo:** os 121 pedidos do S0-5.b estão sendo visitados 2,4
vezes por dia, todos os dias, e **em nenhuma delas ganham rateio**. Fila saudável e defeito vivo
convivem — é precisamente o caso do "caminho feliz que nunca rodou" ao contrário: um caminho que roda
o tempo todo e não faz o que se supõe.

**Conclusão para o S2:** como o backfill não precisa do Alvo (S0-5.c), **não há competição por
recurso** e a ordem de execução deixa de importar.

## S0-7 — Janelas reais: **08h–17h BRT, dias úteis. Não é 24/7.**

```sql
select jobid, schedule, jobname, active from cron.job where jobid=1;
```
→ **jobid 1 · `0 11-20 * * 1-5` · `sync-compras-status-cron-hourly` · active** — minuto 0 das 11h às
20h **UTC** = **08h00 às 17h00 BRT**, segunda a sexta. **10 execuções por dia útil**, zero à noite e
zero no fim de semana. `sync_settings.schedule_cron` guarda a mesma expressão.

> **Corrige o prompt §1.3**, que diz "Roda de hora em hora; 110 execuções em 14 dias". A cadência
> horária está certa, o alcance não: **não roda fora do horário comercial**. Janela segura de deploy:
> **depois das 17h BRT ou no fim de semana** — sem precisar de kill-switch.

## S0-8 — Kill-switch: **existe, e é lido.**

Tabela `sync_settings`, linha `job_name = 'sync-compras-status-cron'`. A função lê em `index.ts:2597`:

```ts
.from("sync_settings").select("enabled, paused_reason")…
if (settings && settings.enabled === false) { …registra sync_run "Sync pausado: <motivo>"… return }
```

Acionamento (SQL para o Pedro colar, **não executado**):
```sql
update sync_settings set enabled = false, paused_reason = '<motivo>'
where job_name = 'sync-compras-status-cron';
-- reverter: set enabled = true, paused_reason = null
```
⚠️ **Duas armadilhas.** (1) A função lê **só** `enabled` e `paused_reason`; **`paused_at` e
`paused_by` não são lidos** — a linha de hoje tem `paused_at = 26/05/2026` com `enabled = true`, ou
seja, um carimbo velho que **não pausa nada** e induz a erro quem olhar a tabela. (2) A pausa **não
impede o pg_cron de disparar**: a função sobe, lê, registra um `sync_run` e sai. Isso é bom (fica
rastro), mas significa que "pausado" ≠ "não executa".

## S0-9 — O episódio de 26–27/08: **externo, transitório e recuperado — mas não como a espec conta.**

| job_type | início (BRT) | disparado por | erros |
|---|---|---|---:|
| `reqmat` | **26/08 18:25** | pg_cron | 151 |
| `produtos` | **26/08 20:00** | pg_cron | 1 |
| **`bicephalous`** | **26/08 22:41** | 🔴 **`manual_admin`** | **152** |

Três correções ao que o prompt §1.3 afirma:

1. **Não foram "os 152 erros de 26–27/08".** Foram de **uma única execução**, em 26/08 às **22h41**.
   Em 27/08 o `bicephalous` rodou 10 vezes, **todas com zero erros**.
2. **Nenhuma execução agendada do `bicephalous` falhou.** As 10 do dia 26 (08h–17h) tiveram zero
   erros. A que falhou foi **manual**, fora da janela do cron.
3. **O padrão não é "o Alvo caiu naquele dia" — é que o Alvo não responde à noite.** As três falhas
   estão às 18h25, 20h00 e 22h41; todas **depois do expediente**. É por isso que o `bicephalous`
   normalmente não sofre: ele **não roda à noite** (S0-7). Quem rodou manualmente às 22h41 encontrou
   o Alvo indisponível — 150 dos 152 erros são o mesmo `HTTP 502: Falha na autenticação do Alvo
   (HTTP 404)` devolvendo HTML.

**Recuperação, confirmada:** nas execuções seguintes (27/08, 08h–11h) o `total_mudaram` saltou para
**49, 46, 50, 36** contra a média de 3–15 — a fila absorveu o atraso e voltou ao normal no mesmo dia.
✅ Nenhum pedido ficou para trás.

## S0-10 (não pedido, achado) — 🔴 **Quatro pedidos ficaram presos em laço de retentativa; hoje resolvidos**

`sync_runs.detalhes` guarda os erros por pedido. Filtrando `c3_filhos`:

| pedido | erro da RPC | tentativas | primeira | última |
|---|---|---:|---|---|
| `0004691` | `PERCENTUAL_CC_INVALIDO: item 1 classe 15.02 soma 99.9999` | 7 | 20/08 10:00 | 24/08 13:15 |
| `0004371` | `PERCENTUAL_CC_INVALIDO: item 1 classe 18.05 soma 99.9999` | 7 | 20/08 09:55 | 24/08 13:12 |
| `0004471` | `PERCENTUAL_CC_INVALIDO: item 1 classe 18.05 soma **0.0000**` | 7 | 20/08 09:55 | 24/08 13:12 |
| `0004602` | `PERCENTUAL_CLASSE_INVALIDO: item 1 soma das classes 0.0000` | 1 | 20/08 09:34 | 20/08 09:34 |

O mecanismo era vicioso e correto ao mesmo tempo: a RPC recusa o lote, o cron **reabre a flag**
(`detalhes_carregados = false`, card C3.2) e o pedido volta na próxima execução — para falhar de novo.
✅ **O card C3.3 (`d767457`, 24/08) fechou os quatro**: hoje têm 11, 3, 9 e 3 linhas de rateio, e
**não há nenhuma falha `c3_filhos` desde 24/08 13:15**. Registro aqui porque a espec não sabia que
isso tinha acontecido, e porque o padrão ("a guarda recusa, a flag reabre, o pedido volta") pode
reaparecer com qualquer forma nova de rateio que o Alvo mandar.

## S0-11 (não pedido, achado) — ⚠️ **Duas execuções que começaram e nunca terminaram**

`02/09 17:00` e `24/07 08:00`: `total_candidatos = 0`, `duracao_ms` e `finished_at` **nulos**,
`observacao` vazia. A linha de `sync_runs` é aberta no começo e fechada no fim; nula significa que a
função **morreu no meio** (timeout ou exceção antes do bloco final). Não houve perda — a execução
seguinte pegou tudo — mas **falha assim é silenciosa**: não conta erro, não escreve motivo, e uma
consulta que filtre por `total_erros > 0` não a enxerga. 2 ocorrências em ~2 meses.

## S0-12 (não pedido, achado) — 🔴 **A função publicada está atrás do `main` em 2 commits**

| | |
|---|---|
| `BUILD_TAG` **publicado** | `MOEDA-PEDIDOS-A2 (2026-08-26)` · version **49** · deploy em **27/08/2026** |
| `BUILD_TAG` no **repo** | `REQ-AUDITORIA-CHECA-ERRO-v2-JOB4 (2026-08-28)` |

Confirmado por marcador: `derivarNaturezaPedido` (commit `ab0e0f3`, 27/08) **está** na versão
publicada; o comentário `"gêmeo que JÁ disparou"` (commit `11cbe2b`, 28/08) **não está**.

**Pendentes de deploy:** `f7185bf` e `11cbe2b` (ambos 28/08, +143 linhas líquidas). Os dois mexem em
**Job 1 / Job 4 (requisições)**, não em pedidos — por isso nada do que foi medido acima está
comprometido. Mas **qualquer deploy futuro desta função leva os dois junto**, quisera ou não. Isso
precisa entrar no plano de deploy do S1/S2 como item explícito, não como surpresa.

---

# §4.5 · Cobertura do prompt

| Item | Estado |
|---|---|
| S0-1 (prioridade) | ✅ medido — sem UNIQUE, e a implementação em produção já usa delete-then-insert |
| S0-2 · S0-3 · S0-4 · S0-5 | ✅ medidos e re-medidos contra a v1 |
| Matriz §4.2 | ✅ 45+ campos, com os 4 escritores e a RPC |
| Prova de 3 pedidos §4.3 | ✅ com limite de evidência declarado (sem Load ao vivo) |
| S0-6 · S0-7 · S0-8 · S0-9 | ✅ respondidos com série temporal e evidência |
| Campos inexistentes no Hub / sem rota | ✅ declarados: prazo do item · quem aprovou no ERP · binário de anexo · `percentual_classe` |
| Achados extras | S0-10 (laço de retentativa) · S0-11 (execuções sem fim) · S0-12 (deploy atrasado) |
| Nenhum código alterado, nenhuma escrita | ✅ só `select` via MCP e leitura de arquivos |

---

# Resumo executivo

1. 🔴 **A FASE S1 já foi executada e está em produção** (cards C3, C3.2, C3.3, D4 — commits `050e88f`,
   `105e1fb`, `d767457`, entre 20 e 24/08). O prompt de 03/09 descreve o mundo de 14/08. O rateio saiu
   de 139 para **863 linhas**; pedidos nascidos no Alvo com rateio, de 4 para **269**.
2. ✅ **Funciona, e a prova é campo a campo:** no `0004691`, 11 linhas de rateio batem **ao centavo**
   com o payload do Alvo. A cobertura mensal subiu de 18% (jun) para **72%** (ago/set).
3. 🔴 **Mas o D1 tem resíduo vivo: 121 pedidos (R$ 1,81 M) que o cron visita ~2,4×/dia e nunca
   corrige.** O gate de reprocesso usa os três jsonb como proxy dos filhos relacionais; na geração
   antiga o proxy é falso-positivo. **A espec supõe que o S1 resolveria estes — não resolve.**
4. 💡 **O backfill ficou muito mais barato: 1.173 dos 1.174 pedidos sem rateio já têm o rateio por
   item persistido no jsonb `itens`.** Dá para reconstruir em SQL puro, sem uma única chamada ao Alvo
   — o que dissolve a restrição de janela, o ritmo de lotes e a competição com o cron da §6.
5. 🔴 **`percentual` tem duas semânticas na mesma coluna** (absoluto no wizard, relativo à classe no
   espelho), sem nada no schema que as declare. Já causou um incidente visível (R$ 191 mil de valor
   fantasma na tela, 27/08), já foi corrigido **no leitor** — e continua sendo a armadilha mais
   provável para a próxima consulta que alguém escrever.
6. ✅ **A fila do Job 2 está estável e caindo** (~440 → ~421 em 7 dias úteis), com rodízio completo.
   Não há atraso estrutural.
7. ✅ **O cron roda 08h–17h BRT, dias úteis** — não 24/7. Janela de deploy segura: após 17h ou fim de
   semana. Kill-switch existe (`sync_settings.enabled`) e é lido.
8. ✅ **O episódio de 26/08 foi uma execução MANUAL às 22h41**, não o cron agendado. O padrão é o Alvo
   não responder à noite. Recuperação total no dia seguinte.
9. 🔴 **A função publicada está 2 commits atrás do `main`** (`f7185bf`, `11cbe2b`, de 28/08). Afetam
   requisições, não pedidos — mas viajam junto no próximo deploy.
10. ⚠️ **O impacto que importa:** 78,5% do valor de 2026 (**R$ 14,76 M**) ainda não tem rateio
    normalizado, e a RPC `listar_pedidos_escopo` — o AJUSTE 7.2, entregue ontem — lê essa tabela.
    Enquanto o backfill não roda, **o escopo do líder de CC se apoia no cabeçalho, que é a primeira
    fatia do rateio.**

---

# O que contradiz esta especificação

| # | O `PROMPT-S0-SYNC-PEDIDOS.md` diz | O medido em 03/09 |
|---|---|---|
| 1 | §5: "FASE S1 — Correção do sync" como trabalho a fazer | 🔴 **Já foi feita e está em produção desde 20–24/08.** O prompt foi escrito sobre o estado de 14/08 |
| 2 | §1: cobertura de 14,3% com rateio, 35,7% com CC | ⚠️ Hoje: **72% e 83%** no coorte de agosto. Os números do prompt são de 14/08 |
| 3 | §4.1-S0-1 / §5-A: criar UNIQUE e fazer upsert por ela | ❌ Não existe, não deve existir, e a produção usa **delete-then-insert** (RPC `sync_replace_filhos_pedido`) |
| 4 | §1.3: "os 152 erros de 26–27/08 foram indisponibilidade do Alvo" e "todos os crons sofreram junto" | ⚠️ Meio certo. Foi **uma execução `manual_admin` às 22h41 de 26/08**. Nenhuma execução **agendada** do `bicephalous` falhou. O padrão é **indisponibilidade noturna**, não um incidente daquele dia |
| 5 | §1.3: "Roda de hora em hora" | ⚠️ De hora em hora **das 08h às 17h BRT, dias úteis** (`0 11-20 * * 1-5`). Não roda à noite nem no fim de semana |
| 6 | §4.4-S0-6: "se a fila cresce, o backfill compete com o cron" | ✅ **A fila não cresce** (−2,7/dia). E o backfill **não precisa do Alvo** (1.173 de 1.174 já têm o payload) — não há competição |
| 7 | §6: "lotes de ~25 Loads com pausa, fora das janelas do cron" | 💡 **Desnecessário.** Backfill em SQL puro a partir do jsonb persistido |
| 8 | §4.2: rateio tem "percentual, valor" | ✅ **Agora tem** — `valor` e `valor_derivado` foram criados. Era 🔴 na v1 |
| 9 | §1.1-D2: "campo que veio vazio fica nulo para sempre" | ✅ **Corrigido** por `completarCamposAusentes`. Restam **9** campos congelados, todos saudáveis. O caso `0004664` está resolvido |
| 10 | §3-regra 11: "agosto reconcilia em R$ 1.642.742,28 (92 pedidos)" | 🔴 **Âncora vencida e não reproduzível.** Agosto hoje: **R$ 2.739.015,00 / 228 pedidos** (o mês não tinha acabado em 14/08). O recorte mais próximo — agosto, pedidos descobertos até 14/08 — dá **R$ 1.583.976,69 / 87**, que também não bate: o Job 2 propaga `ValorTotal` do Alvo e os valores mudaram legitimamente desde então. **A âncora precisa ser recongelada antes do S2** |
| 11 | §4.5: "o pedido `0004495` (itens somando o dobro do cabeçalho)" | ⚠️ Confirmado, e é **pedido nascido no Hub**: item com quantidade **2** × R$ 55.000 contra cabeçalho de R$ 55.000. Não é defeito de sync |
| 12 | §7 (fora de escopo): "aposentar os jsonb" | ⚠️ Os jsonb agora são **estruturais**, não só legado: são o **proxy do gate de reprocesso** (`filhosAusentes`) e a **única fonte viável do backfill**. Aposentá-los exige substituir o gate primeiro |

---

# Perguntas que só o Pedro pode responder

1. 🔴 **O backfill passa a ser SQL puro sobre o jsonb já persistido (1.173 pedidos, sem tocar o
   Alvo)?** É a mudança mais consequente desta Discovery. A alternativa é o plano original (Loads em
   lote), muito mais caro e mais lento. **Bloqueia o desenho do S2.**
2. 🔴 **Os 121 pedidos barrados pelo gate: corrigir o gate ou deixar que o backfill os cubra?**
   Corrigir o gate (deixar de usar jsonb como proxy dos filhos relacionais) evita que o buraco
   reapareça; o backfill sozinho tapa hoje e deixa o mecanismo de pé. **Bloqueia o S1-resíduo.**
3. 🔴 **Recongelar a âncora de reconciliação.** A da regra 11 não é reproduzível. Proponho congelar
   **agosto/2026 = R$ 2.739.015,00 em 228 pedidos** (medido 03/09 09h23 BRT) como novo invariante
   anti-wipe. Confirma?
4. **A dupla convenção de `percentual` fica como está?** Opções: (a) manter e confiar no leitor;
   (b) criar `percentual_classe` e gravar as duas camadas; (c) documentar em `COMMENT ON COLUMN`
   (barato, e hoje não há nada no schema avisando). É a armadilha mais provável de reincidir.
5. **`anexos` entra no cron?** Hoje só o open-load grava — ou seja, um pedido que ninguém abriu na
   tela nunca tem anexo espelhado. É omissão do card C3 ou decisão?
6. **`texto_historico`** continua sem escritor no cron (139 de 2.017). Recuperar ou aposentar?
7. **Deploy pendente:** `f7185bf` e `11cbe2b` estão no `main` e não em produção há 6 dias. Publicar
   junto com o próximo deploy desta função, ou publicar antes, isolado, para não misturar mudanças?
8. **Pedido `0004495`**: quantidade 2 no item contra cabeçalho de R$ 55.000, pedido nascido no Hub.
   Corrigir a quantidade, corrigir o cabeçalho, ou deixar?
9. **Os 2 pedidos `excluido_alvo`** no backfill: pular e logar, ou investigar?
10. **Execuções que morrem no meio** (S0-11, 2 casos): vale instrumentar — um `sync_run` sem
    `finished_at` hoje é invisível para qualquer alarme baseado em `total_erros`?
11. **`compras_pedidos_parcelas` e `anexos` entram na validação do S2**, ou o backfill se limita ao
    rateio (escrita mínima, regra 11)?
12. **Quem aprovou no ERP**: quer o campo? Não existe coluna no Hub e nenhum escritor extrai — só um
    Load ao vivo diz se o payload traz.

---

*Fim da Discovery S0 (revisão 2). Sequência revista: **S1-resíduo** (gate dos 121) → **S2** (backfill
SQL de 1.173) → validação contra a âncora recongelada. A v1 de 14/08 permanece em
`git show 0dce7cb:DISCOVERY-SYNC-RATEIO-PEDIDOS.md`.*
