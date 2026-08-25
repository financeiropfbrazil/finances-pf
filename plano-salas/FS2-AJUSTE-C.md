# FS2 · AJUSTE C — Colunas de custo e origem documental

**Criado em:** 24/08/2026 · **Executado por:** Pedro, direto no SQL Editor (fora do fluxo do agente)
**Status:** ✅ **já aplicado no banco** — este arquivo é **registro**, não tarefa a executar.

> Aditivo. O `FS2-MOVIMENTO.md` permanece **intacto**, inclusive na §C, que descreve as tabelas
> com o número de colunas que tinham no dia em que foram criadas. A divergência entre aquele
> texto e o banco de hoje é **esperada e está explicada aqui**.

---

## §A — Por que existe

O Pedro quer **dashboard de custos** por item de entrada, refugo e saída. A conexão que traz o
custo do Alvo ainda não existe, mas as colunas podem existir desde já: coluna vazia não custa
nada, migração com dado dentro custa.

**Nada mudou no comportamento.** As RPCs (`prod_registrar_entrada`, `prod_registrar_refugo`,
`prod_registrar_saida`) não conhecem esses campos e não os preenchem. As telas da FS3 seguem
funcionando exatamente como antes. As colunas nascem nulas e esperam.

---

## §B — O que foi aplicado

### B.1 `prod_entradas` — 11 colunas novas (20 → 31)

| Coluna | Tipo | Para quê |
|---|---|---|
| `custo_unitario` | numeric(18,6) | custo **por unidade base** |
| `custo_total` | numeric(18,4) | `custo_unitario × quantidade_base` |
| `moeda` | text (default `'BRL'`) | moeda do custo |
| `origem_custo` | text | de onde veio o número — ver §C |
| `custo_capturado_em` | timestamptz | quando o custo foi capturado |
| `nf_serie` | text | série da NF de origem |
| `nf_chave` | text | chave de 44 dígitos da NF-e |
| `fornecedor_codigo` | text | código da entidade no Alvo |
| `reqmat_numero` | text | RM que trouxe o material (casa com `op_reqmat_lotes`) |
| `reqmat_sequencia` | integer | item da RM |
| `codigo_alvo` | text | código do produto no Alvo, redundante por conveniência |

### B.2 `prod_refugos` — 6 colunas novas (18 → 24)

`custo_unitario` · `custo_total` · `moeda` · `origem_custo` · `custo_capturado_em` · `codigo_alvo`

### B.3 `prod_saidas` — 6 colunas novas (16 → 22)

`custo_unitario` · `custo_total` · `moeda` · `origem_custo` · `custo_capturado_em` · `codigo_alvo`

### B.4 Constraints

Uma por tabela, restringindo `origem_custo` a `'NF'`, `'MOVESTQ'`, `'MEDIO'` ou `'MANUAL'`:
`prod_entradas_origem_custo_chk` · `prod_refugos_origem_custo_chk` · `prod_saidas_origem_custo_chk`.

**Todas as colunas são NULLABLE.** Nenhuma tem default além de `moeda = 'BRL'`.

---

## §C — Convenções (leia antes de preencher qualquer uma delas)

1. **`custo_unitario` é por unidade base.** Por **grama** no silicone e no bário, não por
   quilo; por unidade nos demais. É por isso que tem 6 casas decimais.
2. **`custo_total` = `custo_unitario × quantidade_base`** — nunca `× quantidade`, que está na
   unidade que o operador escolheu.
3. **`origem_custo` não é burocracia.** Os quatro valores significam custos diferentes e
   legítimos:

| Valor | O que é |
|---|---|
| `NF` | custo de aquisição, direto da nota fiscal de entrada |
| `MOVESTQ` | custo do movimento de estoque no Alvo — **já embute frete e impostos não recuperáveis** |
| `MEDIO` | custo médio atual do produto no Alvo |
| `MANUAL` | informado por uma pessoa; exige justificativa na observação |

   Sem esse campo, daqui a seis meses ninguém sabe o que o número significa — e os três
   primeiros dão valores diferentes para o mesmo material.

---

## §D — Verificação (executada em 24/08/2026, resultado real)

```sql
select 'prod_entradas' t, count(*) from information_schema.columns
 where table_schema='public' and table_name='prod_entradas'
union all select 'prod_refugos', count(*) from information_schema.columns
 where table_schema='public' and table_name='prod_refugos'
union all select 'prod_saidas', count(*) from information_schema.columns
 where table_schema='public' and table_name='prod_saidas';
```

Resultado: **`prod_entradas` = 31 · `prod_refugos` = 24 · `prod_saidas` = 22** ✔
As 11 + 6 + 6 colunas conferidas uma a uma, e as 3 constraints presentes com a definição correta.

---

## §E — Nota para o agente (importante)

⚠️ Ao ler o `FS2-MOVIMENTO.md` §C, o agente vai ver `prod_entradas` descrita com 20 colunas e o
banco com 31. **Isso não é divergência de projeto nem escrita não autorizada** — é este ajuste,
aplicado pelo Pedro em 24/08/2026 e registrado aqui.

Consequências práticas:

1. **Não "corrigir"** o `FS2-MOVIMENTO.md` para refletir as colunas novas. A regra de
   imutabilidade do plano vale: o original fica como está.
2. **Não preencher** essas colunas, nem alterar as RPCs para preenchê-las. A captura de custo é
   trabalho de uma fase futura (FS4), ainda não especificada nem liberada.
3. **Não criar UI** para custo. As telas da FS3 seguem como estão.
4. Se um pré-voo futuro comparar contagem de colunas, **31 · 24 · 22 é o esperado** a partir de
   24/08/2026.

---

## §F — O que fica aberto (para o Pedro, não para o agente)

1. **Como o custo será capturado.** O Pedro quer **automático**. As opções discutidas:
   custo médio do produto (mais simples, sempre disponível) ou custo do movimento que trouxe o
   lote (mais preciso, exige resolver lote → `MovEstq`). Recomendação registrada: **captura
   assíncrona** — job noturno preenchendo o que estiver nulo —, para que o operador **nunca
   fique bloqueado** se o Alvo estiver fora do ar.
2. **Isso quebra a premissa "MVP 100% Hub".** Capturar custo exige consultar o Alvo. É decisão
   consciente do Pedro, registrada aqui para não parecer desvio de escopo depois.
3. **Refugo de peça pronta não tem custo no Alvo.** A ponteira nunca existiu como movimento de
   estoque — nasce e morre dentro da sala. Custo dela só sai somando os insumos que a compõem,
   o que exigiria a relação insumo→peça que ficou dormindo com a batelada (Ajuste B §A.1).
   Refugo de **insumo** é fácil de valorizar; de **peça**, não.
4. **Tabelas `stock_products` e `stock_produto_unidades`** apareceram na busca por `prod` no
   Table Editor. Não pertencem a este módulo e não foram tocadas — o Pedro confirma a origem
   quando puder.
