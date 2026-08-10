# AT-4.1 — Correção do `Relacionar` com a captura do Network

**P&F Brasil · Controladoria · 10/08/2026 · Fase 4 do módulo OP**

> Card de **correção**, no molde da §6.3-N: a AT-4 fica intacta no repo e em `60183b4`.
> Isto se apende, não substitui.
> ⚠ **Nada aplicado no ERP.** Nenhum `ValidarAtendimento`, nenhum `FinalizarAtendimento`,
> nenhum SQL, nenhum deploy, nenhum Publish.

---

## 1. A medição do §2 — campo a campo

**Pergunta:** dos 12 campos de cadastro que a tela envia no `ClassInstance`, quais o Hub já tem?

**Primeiro resultado, e ele engana:** as 14 chaves existem em **2.563 de 2.563** `raw` de
`op_reqmat_itens`. Chave existir não é valor ter — o preenchimento real:

| Campo | Tenho? | De onde / por que não |
|---|---|---|
| `ControlaLote` | ✅ | `stock_products.controla_lote` — 258 `true` / 2.568 `false`, conferido em 4 espécimes de campo. **No `raw` do Load: nulo em 2.563/2.563** |
| `ProdutoNome` | ✅ | `stock_products.nome_produto`. No Load: nulo em 100% |
| `ProdutoCodigoAlternativo` | ✅ | `stock_products.codigo_alternativo` — para `001.003.00087` dá **`809983`**, **idêntico à captura** |
| `LocArmazNome` | ✅ | `stock_locais_armaz.nome` — `001` → **`ESTOQUE`**, idêntico à captura |
| `Localizacao` | ✅ trivial | a captura envia `""`; o Load traz nulo em 100% |
| `LocalizacaoProduto` | ✅ trivial | a captura envia `null`; o Load já traz nulo |
| `LarguraLiquida` | ✅ | o Load **já traz `0`** em 2.563/2.563, igual à captura |
| **`CodigoTipoProduto`** | ❌ | `stock_products.tipo_produto` **mistura código e nome**: `"15"` (1.342), `"Semi-Acabado"` (213), `"48"` (211), `"Acabado"` (208), `"Matéria Prima"` (130)… Para `001.003.00087` dá **`"Insumos"`**; a captura diz **`"44"`**. Domínios diferentes. `tipo_produto_fiscal` dá `"10"` — também não |
| **`ControlaEstoque`** | ❌ | Única fonte é `rec_laudos.raw_movestq_item` (777 laudos, valor em 100%) — **e é a mesma fonte cujo `ControlaLote` é comprovadamente falso**: `"Não"` em 756/756 itens com lote gravado (§6.2/Resolvidas, §6.3-N l. 714: *"vem `Não` mesmo com 10 lotes gravados no mesmo item. **NÃO usar.**"*). Vizinho de campo desacreditado não vira fonte |
| **`Peso`** | ❌ | O Load traz **`0`** em 2.563/2.563; a captura envia **`1`**. O `raw_movestq_item` traz `1` — mesma fonte acima |
| **`PesoFatorDivisor`** | ❌ | nulo em 100% de tudo que existe no Hub |
| **`PossuiNumSerie`** | ❌ | não existe em nenhuma tabela |

**Faltam 5**, e os cinco moram no cadastro do produto. ⇒ **Pelo critério do §2 do prompt: parei e
estou relatando.** Não inventei valor para nenhum — foi assim que quatro tentativas se perderam
em 05/08.

### 1.1 A terceira via que muda a conta

O prompt supôs que fechar a lacuna custaria **um `Produto/Load` por item**, o que anularia a
economia. **Não é por item — é por produto, e é cacheável.**

- Os 5 campos são de **cadastro**, não de movimento ⇒ um `Produto/Load` por **produto distinto**.
- O universo com controle de lote é **258 produtos**; os itens atendíveis de hoje usam **69**.
- O repo **já tem o molde**: `produtoBulkService` faz `Produto/Load` + `SavePartial` em massa,
  com delay entre chamadas (`Etapa5Execucao.tsx`), e `Produto/Load` já está na whitelist.
- Cacheados em colunas novas de `stock_products` (que já é sincronizado do Alvo), o custo no
  atendimento vira **zero chamadas**.

⚠ **Duas ressalvas medidas, não hipotéticas:** os flags moram em `ProdEmpresaFilialChildList`, não
na raiz do `Produto/Load` (§6.3-N l. 714 e §9.8) — e existe pelo menos **um produto com essa child
list vazia** (`001.003.00020`, §9.8), isto é, cadastro incompleto no ERP. A carga precisa tratar
ausência como ausência, nunca como `"Não"`.

⇒ **É decisão sua**, e são três caminhos:

| Caminho | Custo | Risco |
|---|---|---|
| **(a) Carga única** de 258 `Produto/Load` → 5 colunas novas em `stock_products` | 1 SQL + 1 rotina (molde pronto) | O de sempre com cadastro incompleto |
| **(b) `Produto/Load` sob demanda** no atendimento, 1 por produto distinto da RM | +1,7 chamadas por RM em média (máx 14) | Gateway compartilhado; latência na abertura do modal |
| **(c) Aritmética local** — abandonar o `Relacionar` e distribuir na ordem da lista até fechar | zero chamadas | Sai da lógica do servidor. **Mas o §1.5 mostra que ele não é FEFO: é distribuição sequencial sobre lista ordenada — reproduzir isso é aritmética de dez linhas** |

**Minha recomendação: (a).** Paga uma vez, serve à AT-5 e a tudo que vier depois, e mantém o
`Relacionar` — que é a lógica do ERP, e foi sua escolha consciente. **(c)** é o plano B honesto,
e depois do §1.5 ele deixou de ser aproximação: é exatamente o que o endpoint faz.

---

## 2. O que foi corrigido no código

`src/services/alvoReqMatAtendimentoService.ts` — aditivo, sem tocar no que já funcionava.

| # | Defeito | Correção |
|---|---|---|
| 1 | Quantidade ia no `ClassInstance`, e a AT-4 discutia **qual campo** dele a carregava | **`Quantidade` no topo do envelope**, irmão de `Origem`. O `ClassInstance` vai com as quantidades **intactas do Load** |
| 2 | Alocação lida da **raiz** da resposta | Lida de **`resposta.Item.CtrlLoteItemReqMatChildList`**. Fallback para a raiz **com `console.warn`** — se disparar, o contrato mudou e alguém precisa olhar |
| 3 | 🔴 **Terceiro defeito, não listado no prompt:** o array ia como **`Lista`** | A captura mostra **`ListaCtrlLoteLocArmaz`**. Corrigido — ver pergunta 1 |
| 4 | Lotes iam sem marcação | **`selected: true`** em cada linha |
| 5 | `DataAtendimento` com instante e fuso | **Data zerada sem fuso** (`hojeNoAlvoSemFuso`). O **cabeçalho** segue com o instante e milissegundos (§1.8) |
| 6 | Item cru nas chamadas de lote | **`enriquecerItemDeCadastro`** com os 7 campos que o Hub tem; os 5 que faltam **não são enviados**, e o comentário lista quais e por quê |

**Além do pedido, dois ajustes que decorrem:**

- O item enriquecido vai também no **`ListaCtrlLoteLocArmaz`** (a chamada da lista), não só no
  `Relacionar` — a tela manda o mesmo objeto nas duas, e nunca chamamos a lista com o item do
  nosso Load com sucesso (o teste da AT-1 deu 417 com payload vazio).
- `ItemAtendimento` ganhou `itemParaLote`, separado de `itemLoad` **de propósito**: o objeto que
  volta ao Alvo no Validar é montado da **releitura**, e não pode carregar campo que o Hub
  acrescentou.

### Verificação

| Comando | Resultado |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | **exit 0** |
| `bun run build` | **exit 0** · `✓ built in 16.37s` |
| `npx eslint src/services/alvoReqMatAtendimentoService.ts` | **33** erros · HEAD tinha **32** (medido com `git stash`) |

O erro a mais é **um `(supabase as any)`** em `catalogoDeLocais` — o padrão do repo, idêntico ao
`catalogoDeProdutos` na função acima. Os outros 32 são pré-existentes, todos `no-explicit-any`.

🔴 **Nada disto foi exercitado contra o ERP.** O código está correto **em relação à captura**; a
captura é de uma tela, não do nosso payload. Enquanto os 5 campos faltarem, o `Relacionar` pode
continuar respondendo `NullReferenceException` — que não diz qual campo falta.

---

## 3. Cards de retificação — texto pronto, você cola

### 3.1 → `PLANO-RM-ATENDIMENTO.md` §2.6 e `PLANO-OP.md` §10.31

> **Retificação de 10/08/2026 — o `RelacionarCtrlLoteLocArmaz` NÃO é um alocador FEFO.**
> As duas seções o chamam de "o alocador FEFO do servidor" e concluem que "o Hub não precisa
> implementar FEFO". A captura do Network (RM `0000002278`, seq 1, 10/08) mostra outra coisa: a
> tela manda **todos** os lotes com **`selected: true`** e o endpoint **distribui na ordem da
> lista** — 4 lotes marcados, `Quantidade: 12`, resultado **6 + 6**.
> ⇒ **O FEFO está na ORDENAÇÃO da lista**, que o `ListaCtrlLoteLocArmaz` já entrega por validade
> (medido em 09/08), **não neste endpoint**. Ele é um distribuidor sequencial.
> ⇒ Consequência prática: reproduzir a distribuição localmente é aritmética de dez linhas sobre
> uma lista já ordenada — o que torna viável o caminho (c) da AT-4.1 caso o enriquecimento do
> item não compense.

### 3.2 → `RETOMADA-AT-4.md` §3.9 e §5

> **Fechada em 10/08/2026 — e a pergunta estava errada.**
> A §3.9 registra como incerteza "qual campo do `ClassInstance` o `Relacionar` lê como quantidade
> a atender", e a §5 pedia uma medição no console para distinguir acumulado de diferença.
> **A quantidade não vai no `ClassInstance`:** é **campo de topo do envelope** (`Quantidade`),
> irmão de `Origem`, e o `ClassInstance` vai com as quantidades **intactas do Load**. Nenhuma das
> três hipóteses testáveis (acumulado / diferença / saldo) descreveria o contrato — a medição
> planejada teria devolvido resultado e ainda assim não teria achado o campo.
> **E havia um segundo defeito, independente:** a resposta vem embrulhada em **`Item`**, e o
> serviço lia da raiz ⇒ mesmo com a quantidade certa, a alocação sairia **vazia e em silêncio**.
> **E um terceiro:** o array de lotes vai como **`ListaCtrlLoteLocArmaz`**, não `Lista`.
> ⇒ Lição da família "o caminho feliz que nunca rodou": três defeitos coexistiam num trecho que
> compilava, tinha comentário denso e nunca fizera uma chamada.

### 3.3 → `PLANO-RM-ATENDIMENTO.md`, seção "Ajustes" (observação ao A3)

> **Observação ao Ajuste A3 (10/08/2026) — não conclua ainda.**
> O A3 afirma que **`GeraPendencia = "Sim"` nunca ocorre sem `GeraEmpenho = "Sim"`** (66/66). A
> captura de 10/08 mostra, num item **ABERTO**, `GeraPendencia: "Sim"` com `GeraEmpenho: "Não"` —
> combinação que o A3 dá como inexistente.
> ⚠ **A medição do A3 varreu itens ATENDIDOS**; a captura é de um item **antes** do atendimento.
> Hipótese: o campo é normalizado no atendimento. **Registrado como observado, não como
> conclusão** — fechar exige medir `GeraPendencia` × `GeraEmpenho` em itens abertos, no `raw`.

### 3.4 → `PLANO-OP.md` §6.3-N (catálogo de armadilhas)

> **10/08/2026 — o `ReqMat/Load` devolve as chaves do cadastro do produto com valor NULO.**
> Não é ausência de chave: as 14 chaves (`ControlaLote`, `ControlaEstoque`, `CodigoTipoProduto`,
> `ProdutoNome`, `ProdutoCodigoAlternativo`, `LocArmazNome`, `Peso`, `PesoFatorDivisor`,
> `PossuiNumSerie`, `LarguraLiquida`, `Localizacao`, `LocalizacaoProduto`…) existem em **2.563 de
> 2.563** `raw` do espelho, e **dez delas vêm nulas em 100%**. Só `Peso` (`0`),
> `LarguraLiquida` (`0`) e `QuantidadeEmpenhar…` trazem valor — e o `Peso` do Load (`0`) **diverge
> do que a tela envia** (`1`).
> ⇒ **Testar `if (raw.ControlaLote)` dá `false` para produto que controla lote.** A fonte continua
> sendo `stock_products.controla_lote`. Mesma família do `ControlaLote` do MovEstq (§6.3-N l.714),
> por outro caminho: aqui a chave existe e mente por omissão.

---

## Perguntas

1. **A captura do §1.1 mostra o envelope do `Relacionar` com 6 chaves** (`Origem`, `OperacaoLote`,
   `OperacaoRM`, `ClassInstance`, `ListaCtrlLoteLocArmaz`, `Quantidade`); o envelope da **lista**
   (§10.31) tem 11 — inclui `Data`, `DataMovimentacao`, `EspecieDocumento`, `NumeroDocumento`,
   `SerieDocumento`, `SequenciaDocumento`, `CodigoTipoLanc`. **Foi abreviação sua ou o
   `Relacionar` vai mesmo com 6?** Mantive as 11 e acrescentei `Quantidade`: campo a mais num
   payload .NET costuma ser ignorado, campo a menos dá `NullReferenceException`. Se a captura
   mostra literalmente 6, eu enxugo.

2. **Qual dos três caminhos do §1.1** — (a) carga única cacheada, (b) `Produto/Load` sob demanda,
   (c) aritmética local? Recomendo **(a)**. Se escolher (a), o próximo passo é um `sql/AT-4.2.sql`
   com as 5 colunas em `stock_products` mais a rotina de carga; se escolher (c), são ~10 linhas
   no serviço e o `Relacionar` sai do caminho.

3. **A `MEDICAO-AT5.md` da rodada anterior está obsoleta em parte.** Os blocos 1 e 2 (espécimes A
   e B) foram escritos para achar o campo do `ClassInstance` — pergunta agora **morta**. O que
   continua valendo é o **`Object.keys()` da linha de lote** (o `Saldo Calc` da §10.20) e o
   **espécime B** (reserva/empenho em item com empenho), que o §1.9 diz não terem aparecido na
   captura — mas a captura é do `Relacionar`, e a lista é outro endpoint. Reescrevo o arquivo
   reduzido a isso, ou descarto e sigo direto para a AT-5 quando a pergunta 2 estiver respondida?
