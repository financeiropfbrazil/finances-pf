# AJUSTE-RS-C3.1 — Regras derivadas da inspeção de pedidos reais
### Complemento ao `AJUSTE-RS-C3.md` · cards C3 e E2 do `PLANO-REVISAO-SUPRIMENTOS-v1.1.md`

> **Documento aditivo.** Não altera o `AJUSTE-RS-C3.md` (que permanece válido) nem o plano.
> Acrescenta quatro regras que só apareceram ao inspecionar dados reais no banco.
> **Base factual:** consultas no banco `hbtggrbauguukewiknew` em 19/08/2026, sobre os
> pedidos **0003077**, **0003575** (geração antiga) e **0004453**, **0004640** (geração
> pós-`d44da61`), cruzadas com o `PedComp/Load` do 0004640 e do 0003625.

---

## 1. Retrato medido — duas gerações do mesmo defeito

| | 0003077 · 0003575 (jan–mar) | 0004453 · 0004640 (jul–ago) |
|---|---|---|
| `itens` (jsonb) | preenchido | **`[]`** |
| `parcelas` (jsonb) | 10 e 4 linhas | **`[]`** |
| `classe_rateio` (jsonb) | preenchido, 2 níveis | **`[]`** |
| `centro_custo` | preenchido | 0004453 nulo · 0004640 **preenchido** |
| `classe_rec_desp` | preenchido | **nulo nos dois** |
| `cnpj_entidade` / `nome_cond_pag` / `primeiro_vencimento` | preenchidos | **nulos** |
| `compras_pedidos_itens` | populado | populado |
| `compras_pedidos_itens_rateio` | **0 linhas** | **0 linhas** |
| `compras_pedidos_parcelas` | **0 linhas** | **0 linhas** |
| `detalhes_carregados` | `true` | `true` |

Leitura: a geração antiga perdeu **a normalização** (jsonb tem tudo, tabelas relacionais
vazias). A geração nova perdeu **o dado inteiro**, e mesmo assim carimba
`detalhes_carregados = true`.

---

## 2. Regras novas

### C3.1-A — "Ausente" inclui **array vazio**, não só nulo
Medido: `jsonb_array_length` retornou **0** (não `-1`, o sentinela usado para nulo) em
`itens`, `parcelas` e `classe_rateio` dos pedidos de julho/agosto. Os jsonb estão como
`'[]'::jsonb`, **não** como `NULL`.

Consequência dura para o bloco "completar ausentes" do C3: a condição **não pode** ser
`is null`. Tem de ser, para cada campo jsonb:

```
campo is null OR campo = '[]'::jsonb OR jsonb_array_length(campo) = 0
```

Se o C3 for escrito só com `is null`, ele roda, não acusa erro, e **não corrige nenhum**
dos pedidos da geração nova — que são exatamente os que motivaram a missão.
> Confirma e torna acionável o achado 5 do CDX-2 ("preencher apenas nulo não trata jsonb `[]`").

### C3.1-B — Validação forte é o **percentual**; `Valor` do item pode vir zero
Medido no **0003575**: o rateio dentro do item traz `"valor": 0` com `"percentual": 100`,
enquanto o item vale R$ 144.000 e o rateio de cabeçalho traz o valor correto.

Portanto, o `Valor` do nível de item **não é confiável isoladamente**. Regra para a RPC
`sync_replace_filhos_pedido`:

1. **Validação forte:** `sum(percentual)` = 100,0000 por (item, classe) e por item. É a que
   decide aceitar ou rejeitar.
2. **Persistência do valor:** gravar o `Valor` do Alvo quando `> 0`; quando vier `0` ou
   nulo **e** o percentual for válido, **derivar**: `valor = round(total_do_item_com_impostos
   × percentual / 100, 2)`, com residual na última linha do item.
3. Marcar de alguma forma rastreável (coluna, flag ou log em `sync_runs`) que aquele valor
   foi derivado, não veio do ERP — para o dia em que alguém comparar Hub × Alvo centavo a
   centavo.
4. Continua valendo o C3-D do ajuste anterior: **nunca** validar `sum(valor)` contra o
   valor do item sem impostos.

### C3.1-C — Backfill da geração antiga sai do **jsonb**, sem tocar o Alvo
Medido: o `classe_rateio` dos pedidos antigos já tem a estrutura de dois níveis que a
tabela relacional precisa —
`[{classe, percentual, valor, centrosCusto:[{codigo, percentual, valor}]}]`, e o jsonb
`itens` carrega ainda `classeRateio` **por item** e um `centroCusto` por item (informação
que a tabela normalizada não tem).

Consequência para o card **E2 (backfill)**: dividir em duas trilhas.
- **Trilha 1 — jsonb → relacional.** Pedidos com `classe_rateio` preenchido. Zero chamadas
  ao Alvo, zero risco de rate limit, roda em minutos. Cobre a geração antiga.
- **Trilha 2 — Load → tudo.** Só os pedidos com jsonb vazio (geração nova). São os que
  exigem chamada ao gateway, em lotes de ~25 com pausa.

Isso reduz materialmente o volume da trilha cara e deve ser medido no início do E2
(quantos pedidos 2026 caem em cada trilha).

### C3.1-D — `centro_custo` preenchido com `classe_rec_desp` nulo é prova de origem diferente
Medido no **0004640**: `centro_custo = 00008.00001.00006` com `classe_rec_desp = null`.
No Alvo, os dois vêm do **mesmo** bloco de rateio — não há como um chegar sem o outro pelo
Load. Logo, o `centro_custo` chegou pelo `/ped-comp/list` (payload leve da descoberta) e a
classe nunca chegou.

Reforça o **C3-E**: `compras_pedidos.centro_custo` não é fonte de relatório por CC, e sua
presença **não** indica que o rateio foi carregado. Nenhuma lógica do C3 pode usar essa
coluna como sinal de completude.

---

## 3. Caso-teste canônico do C3

**Pedido 0004640** (11/08/2026, R$ 114.639,99, WATERS TECHNOLOGIES).

*Estado atual no Hub:* 2 itens normalizados (R$ 60.307,32 + R$ 45.286,57 = R$ 105.593,89),
`rateio_norm = 0`, `parcelas_norm = 0`, `itens`/`parcelas`/`classe_rateio` = `[]`,
`classe_rec_desp` nulo, `cnpj_entidade` nulo, `nome_cond_pag` nulo,
`primeiro_vencimento` nulo, `detalhes_carregados = true`.

*Verdade no Alvo (Load conferido em 19/08):* rateio por item, classe **19.02**, CC
**00008.00001.00006** a 100%, valores R$ 69.353,42 (item 1, **inclui IPI de R$ 9.046,10**) e
R$ 45.286,57 (item 2), somando R$ 114.639,99 = `valor_total`.

*Critério de aprovação do C3:* após um ciclo, o Hub deve ter 2 linhas em
`compras_pedidos_itens_rateio` com classe 19.02 e o CC acima, percentual 100,0000 por item,
soma de valores = R$ 114.639,99, `classe_rec_desp` preenchido, e os jsonb da transição
populados. **`valor_total` não pode mudar.**

**Segundo caso (multi-item, geração antiga):** 0003056, 7 itens.
**Terceiro caso (multi-CC real):** 0003625, 12 linhas de rateio em 2 classes — o único
medido com divergência de centavos entre cabeçalho e item.

---

## 4. Pendência cosmética registrada (fora do escopo do C3)

Na tela de detalhe da requisição, o campo **Centro de Custo exibe só o código**
(`00007.00001.00003`) — sem o nome. Mesma observação vale para conferir na tela de pedido.
O espelho `cost_centers` tem o nome; é junção de exibição, não mudança de dado.
**Não entra no C3** (que é sync/dados). Vira card próprio do Bloco F, junto das demais
melhorias de UI. Evidência: requisição **0001436**, 19/08/2026.

---

*Ajuste v1.0 — 19/08/2026. Deriva de inspeção de dados reais, não de documentação. Próxima
alteração = `AJUSTE-RS-C3.2.md`.*
