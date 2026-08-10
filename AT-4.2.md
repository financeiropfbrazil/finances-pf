# AT-4.2 — Cache do cadastro de produto

**P&F Brasil · Controladoria · 10/08/2026 · Fase 4 do módulo OP**

> Card **novo**. A AT-4 (`60183b4`) e a AT-4.1 ficam intactas — disciplina da §6.3-N.
> ⚠ **Nada aplicado.** Nenhum SQL rodado, nenhuma carga executada, nenhum deploy, nenhum Publish.
> Nenhum `ValidarAtendimento`, nenhum `FinalizarAtendimento`, nenhum `Produto/SavePartial`.

---

## 1. O que isto resolve

O `ReqMat/Load` devolve as chaves do cadastro do produto com **valor nulo** — as 14 chaves existem
em **2.563 de 2.563** `raw` do espelho, e dez vêm nulas em 100%. A tela de Atendimento do Alvo
manda esses campos preenchidos no `ClassInstance`, e sem eles o ERP responde
`NullReferenceException`, que não diz qual campo falta.

Cinco não existiam em lugar nenhum do Hub. O `Produto/Load` os tem, e a comparação com a captura
da tela fechou **5/5**. ⇒ **Carga única de 258 produtos**, cacheada. Custo no atendimento: **zero
chamadas**.

---

## 2. A entrega

| Arquivo | O que é |
|---|---|
| `sql/AT-4.2.sql` | 12 colunas em `stock_products` · tabela `stock_produto_unidades` · RPC `stock_produto_cadastro_aplicar` (gate `compras.cadastros.sync`) · verificação empírica (10 queries) · rollback |
| `src/services/produtoCadastroLoteService.ts` | A carga, sobre o `loadProduto()` que já existia. **Novo** |
| `src/pages/Settings.tsx` | Botão **"Carregar cadastro de lote"**, em Produtos |
| `src/services/alvoReqMatAtendimentoService.ts` | O enriquecimento passa a ler do cache; produto sem cache **bloqueia o item** |

### 2.1 Por que tabela, e não coluna nem jsonb

`Peso` e `PesoFatorDivisor` são **por unidade**, não do produto. Guardar só a base erraria onde a
conversão importa — medido: **6 produtos com lote em 79 itens de RM** usam posição ≠ 1, e **5 dos
6 estão atendíveis hoje**:

| Produto | Base | Na RM | Pos. | itens | fator observado |
|---|---|---|---|---|---|
| `001.003.00017` | PACOTE | MILHEI | 2 | 21 | 0,001 |
| `001.003.00047` | GALAO | LITRO | 2 | 19 | **1,000** ⚠ |
| `001.003.00016` | PACOTE | MILHEI | 3 | 13 | 0,001 |
| `001.003.00015` | PACOTE | MILHEI | 2 | 12 | 0,001 |
| `001.003.00095` | UNID | LITRO | 2 | 8 | **1,000** ⚠ |
| `001.007.00019` | M | BOBINA | 2 | 6 | 0,001 |

O desempate foi o **`CX` duplicado do `001.003.00029`** (posições 2 e 3, pesos 70 e 72): numa PK
`(produto, posição)` são duas linhas conferíveis; num jsonb, ruído invisível.

A tabela é modelada **para além do atendimento** — PK natural, índice por unidade,
`sincronizado_em` por linha, nada específico de RM. É a peça de conversão que o módulo de estoque
por local vai consumir inteira.

### 2.2 A separação, que virou regra do arquivo

| Uso | Fonte |
|---|---|
| `Peso` / `PesoFatorDivisor` no **`ClassInstance`** | **cache do cadastro** (AT-4.2) |
| `Quantidade2` / `QuantidadeAtendida2` / `QuantidadeSaldo2` do **payload** | **fator do próprio item** (`fatorSegundaUnidade`), inalterado |

À luz da regra do `"Fator"` (que **divide**), o `001.003.00047` com fator observado **1,000** num
par GALAO→LITRO **não é "sem conversão": é conversão faltando no cadastro** — um galão contando
como um litro. Se o Hub recalculasse pelo peso, 19 itens mudariam de valor sem que ninguém tivesse
pedido. ⇒ Divergência vira **relatório** (query **j** da verificação), nunca conserto silencioso.
Alimenta o §9.8.

### 2.3 Produto sem cache **bloqueia** o item

Item **com** controle de lote e `cadastro_alvo_em IS NULL` não segue: `avisoLotes` com mensagem
que diz o que fazer, e a validação nº 4 barra o envio. A alternativa seria mandar o payload
incompleto e torcer — que é exatamente como quatro tentativas se perderam em 05/08.
Item **sem** controle de lote não passa por essa guarda: ele não chama a lista nem o `Relacionar`.

### 2.4 Revisão 2 (10/08/2026) — três defeitos achados em teste local, antes de aplicar

O Pedro rodou o SQL num Postgres 16 local. **Passaram:** o caminho feliz (o `CX` nas posições 2 e
3 convivendo, 3 linhas), lista vazia não apagando a escala, e o gate fechado devolvendo
`sem_permissao`. **Falharam três coisas:**

| # | Defeito | Correção |
|---|---|---|
| **C** | `{"quantidade_dias_validade_lote": ""}` → `invalid input syntax for type integer: ""`. **Estourava a RPC inteira**, e o Alvo devolve `""` com frequência (o payload capturado tem `NumeroCavalete: ""`, `CodigoBarras: ""`) | `nullif(…,'')` antes de **todo** cast — e também nos campos `text`, onde `""` num enum não é valor, é ausência |
| **D** | O mesmo em `peso` (`::numeric`) e em `posicao` (`::integer`) | idem; `posicao` sem valor é **descartada**, não vira `0` — posição 0 seria uma unidade inventada |
| **E** | 🔴 O `on conflict` **não protegia do que o comentário dizia proteger**: duas linhas com a mesma posição no mesmo payload dão *"ON CONFLICT DO UPDATE command cannot affect row a second time"* | Deduplicação explícita **antes** do insert (`distinct on (posicao) … order by posicao, ord` — a primeira ocorrência vence, de forma determinística) e a duplicata **contada e devolvida** em `posicoes_duplicadas` |

O **E** é o pior dos três, e não pelo bug: **o comentário afirmava uma proteção que não existia**.
Quem lesse o arquivo concluiria que o caso do `001.003.00029` estava tratado. O comentário agora
descreve o que o código faz, e diz por que o `on conflict` não serve aqui.

⚠ **O que continua estourando de propósito:** valor não numérico que **não** seja `""` (por
exemplo `"abc"` num campo de dias). Seria formato novo do ERP, e a carga trata a exceção **por
produto** — aquele produto entra em `erros[]` com a mensagem do Postgres e os outros 257 seguem.
Falhar alto num caso desconhecido é melhor que gravar `NULL` em silêncio em todos.

**Contrato da RPC mudou**, e o TypeScript acompanhou: o retorno ganhou `unidades_recebidas` e
`posicoes_duplicadas`, e a carga os registra em `ResultadoCarga.posicoesDuplicadas` — sem isso a
contagem morreria dentro da RPC. O toast passa a marcar posição repetida como achado.

✅ **FK conferida em produção** (a medição que faltava): `stock_products_codigo_unique UNIQUE
(codigo_produto)` existe ⇒ a FK da tabela nova é válida e o desenho não muda.

---

## 3. Como o Pedro dispara — nesta ordem

1. **Aplicar `sql/AT-4.2.sql`** no SQL Editor. Rodar a verificação (a) a (e) e colar o resultado.
   🔴 **O SQL vem antes do deploy.** Sem as colunas, o `select` do serviço falha e o botão da
   carga responde 404 (PostgREST sem schema recarregado).
2. **Publish** no Lovable.
3. **Configurações › Produtos › "Carregar cadastro de lote"**. ~3,5 min (258 chamadas a 750 ms,
   sequenciais — o gateway é compartilhado com 100+ usuários). O andamento aparece abaixo do
   botão; o relatório completo, no console (F12).
4. Rodar a verificação **(f) a (j)** e colar. A **(h)** e a **(j)** são as que podem trazer achado
   de cadastro.

**Cobertura reportada ao fim da carga**, como pedido: carregados · falhas · sem escala de unidades
· sem filial `1.01` · divergências de `ControlaLote` (raiz × filial) · unidades com regra
`"Divisor"` · sem dias de validade.

---

## 4. O acréscimo de escopo — e a régua de vencimento

As seis regras de lote da raiz entraram na mesma chamada, custo zero:
`QuantidadeDiasValidadeLote` · `PrazoValidade` · `PrazoValidadeDias` · `NumeroLoteAutomatico` ·
`BaseGeracaoAutomaticaLote` · `UtilizaDimensoesLote`.

A cobertura de `quantidade_dias_validade_lote` sai na query **(i)**. **A decisão da régua é da
AT-5** — este card só garante que o dado exista. Se a cobertura for baixa, a AT-5 fica com um
limiar fixo e isso passa a ser escolha informada, não omissão.

⚠ Os dois campos "dias" são `integer` com **coerção defensiva**: valor não inteiro grava `NULL` e
entra em `camposNaoNumericos` no relatório. O domínio deles não foi medido, e converter o que não
se conhece esconde mudança de formato do ERP.

---

## 5. Verificação

| Comando | Resultado |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | **exit 0** |
| `bun run build` | **exit 0** · `✓ built in 13.61s` |
| `npx eslint src/services/produtoCadastroLoteService.ts` | **1** — um `(supabase as any)`, o padrão do repo |
| `npx eslint src/pages/Settings.tsx` | **4** — e o HEAD já tinha **4** (nenhum novo) |
| `npx eslint src/services/alvoReqMatAtendimentoService.ts` | **34** · era **33** na AT-4.1, **32** no HEAD original |

Os erros novos são **dois `(supabase as any)`** — um em `catalogoDeUnidades`, outro na listagem da
carga. É o padrão de acesso a dados do repo, idêntico às funções vizinhas.

🔴 **Nada foi exercitado contra o ERP nem contra o banco.** O SQL não foi aplicado e a carga não
rodou. O que existe é código correto em relação à captura e ao pré-voo — e o pré-voo cobriu **um**
produto.

---

## 6. Cards de retificação — texto pronto, o Pedro cola

### 6.1 → `Endpoints_Alvo.md` §4 (quando o arquivo entrar no repo)

> **Confirmação de 10/08/2026 — `Produto/Load` é a fonte dos campos de cadastro que o
> `ReqMat/Load` não dá.**
> Parâmetro é **`codigo`** (não `produto`, não `Codigo`); canônico:
> `Produto/Load?codigo=…&loadChild=All&loadOneToOne=All`. Provado pelo gateway em
> `GET /produto/load?codigo=001.003.00087` (status 200) — **a rota do `erp-proxy` já traz as child
> lists**, não é preciso passthrough.
> **Comparação campo a campo com a captura da tela de Atendimento: 5/5.**
>
> | Campo | Tela | `Produto/Load` | Onde mora |
> |---|---|---|---|
> | `CodigoTipoProduto` | `"44"` | `44` | raiz |
> | `ControlaEstoque` | `"Sim"` | `Sim` | raiz |
> | `PossuiNumSerie` | `"Não"` | `Não` | raiz |
> | `Peso` | `1` | `1` | **`ProdUnidMedChildList`**, `Posicao` 1 |
> | `PesoFatorDivisor` | `"Fator"` | `Fator` | **`ProdUnidMedChildList`**, `Posicao` 1 |
>
> ⚠ **`Peso` na RAIZ vem `undefined`** — é o campo estando onde devia, não falha. Registrado para
> que ninguém "conserte" lendo da raiz depois.
> ⚠ `ControlaLote` veio `"Sim"` **na raiz** e também na `ProdEmpresaFilialChildList`; aqui os dois
> concordam. A **filial manda** (§6.3-N), e a child list **pode vir vazia** em cadastro incompleto
> (`001.003.00020`, §9.8) — nesse caso o Hub grava `NULL`, **nunca `"Não"`**.
> 🔴 **`"Fator"` DIVIDE** (GALAO com LITRO peso 0,2 ⇒ 5 litros por galão); **`"Divisor"`
> MULTIPLICA e está ERRADO** — cadastrado assim, 11 galões viraram 2,2 litros.
> ⚠ `SaldoEstoqueTotal` e `SaldoEstoqueDisponivel` do `Produto1Object` vêm **0** mesmo com saldo —
> não confiáveis.

### 6.2 → `PLANO-OP.md` §8, backlog

> **BL-33 — `stock_products` tem escrita aberta a qualquer autenticado.**
> A policy `Allow all for authenticated` cobre **todos os comandos** com predicado `true`: qualquer
> um dos 100+ usuários do Hub pode alterar ou apagar o catálogo de produtos, que é o que decide
> `controla_lote` no atendimento de RM e alimenta o picker da criação. É a classe do **BL-5**.
> ⚠ A AT-4.2 **não repetiu** o padrão: a `stock_produto_unidades` nasce só com policy de SELECT, e
> a escrita passa pela `stock_produto_cadastro_aplicar` (DEFINER, gate `compras.cadastros.sync`).
> Corrigir a policy antiga é tarefa própria, com regressão — várias telas escrevem em
> `stock_products`.
>
> **BL-34 — `alvoProdutoService.syncProdutos` está quebrado, e em silêncio.**
> Grava em **`produtos_cache`, tabela que não existe** no banco, e chama o ERP **direto**
> (`https://pef.it4you.inf.br/api`), sem o gateway — o que dá CORS a partir do navegador. O erro
> morre num `console.warn` e o botão "Sincronizar Produtos" (Configurações › Produtos) devolve
> **0**. Ninguém percebeu porque zero parece "nada mudou".
> ⚠ **Não é o mesmo botão da AT-4.2**, que é novo e usa o gateway. Decidir entre consertar
> (apontar para `stock_products` via gateway) ou remover.

---

## Perguntas

1. **Rodo a verificação (a)–(e) por você depois de aplicar o SQL?** Consigo pelo MCP em read-only
   — as cinco são `select`. As (f)–(j) só fazem sentido depois da carga.

2. **A carga cobre os 258 (245 ativos + 13 inativos).** Incluí os inativos de propósito: produto
   inativado ainda aparece em RM antiga em aberto, e sem cache o item seria bloqueado. Se preferir
   só os ativos, é um `.eq("ativo", true)` a mais.

3. **Se a query (h) trouxer divergência de `ControlaLote` raiz × filial**, o Hub **não se corrige
   sozinho** — sai no relatório e fica para você decidir. Está certo assim? A alternativa (a
   filial sobrescrever `controla_lote` automaticamente) trocaria um erro visível por um invisível
   numa flag que decide se a tela pede lote.
