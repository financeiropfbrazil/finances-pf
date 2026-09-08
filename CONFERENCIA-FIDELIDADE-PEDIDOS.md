# CONFERÊNCIA DE FIDELIDADE — Pedidos de Compra

> Read-only, 08/09/2026, 13h–14h BRT. Projeto `hbtggrbauguukewiknew`.
> Nenhuma escrita no banco, nenhum pedido de teste, nenhuma alteração de código nesta frente.
> Complementa `DISCOVERY-PEDIDOS-CONFIABILIDADE.md` (commit 2403d84), que provou que o cron
> **roda**. Este arquivo responde se o que ele **grava é fiel ao Alvo**.
>
> Fonte da verdade usada: `compras_pedidos_auditoria.resposta_alvo` — payload cru do ERP,
> escrito direto de `resp.data`, sem passar pelos mapeadores. Comparação contra o payload
> **mais recente** de cada pedido. 1.343 pedidos têm payload cru disponível.

---

## B5 — VEREDITO (a resposta curta)

**(i) Os VALORES do Hub são confiáveis?**
O **cabeçalho sim, sem exceção** — `valor_total` bate com o Alvo em **1.343 de 1.343 pedidos
(100%)**. O **detalhe não**: 41 pedidos têm soma de itens divergente, num total de
**R$ 411.694,55**, e 85 de 1.307 parcelas têm valor divergente.
→ Os 41 estão dissecados um a um na **§B6**, com o mecanismo provado e a conclusão de que
**o erro é do Hub, nunca do Alvo**.

**(ii) Os pedidos estão COMPLETOS?**
Não todos, mas está melhorando rápido: cobertura de rateio subiu de 18,5% (março) para **87%
(agosto/setembro)** — acima dos 72% medidos em 03/09. Hoje ~4% dos pedidos de agosto não têm
rateio e 31 pedidos não têm nenhum item no Hub.

**(iii) O que um Controller NÃO deve usar do Hub hoje sem conferir no ERP?**
**Qualquer análise por item, por parcela ou por centro de custo do cabeçalho.** Valor total de
pedido e contagem de pedidos podem ser usados com confiança. Gasto por produto, por CC, por
classe e previsão de vencimento, não.

---

## O achado que explica quase tudo: o detalhe é carregado uma vez e nunca reconciliado

O cabeçalho é reescrito a cada ciclo do cron. **Os filhos — itens, rateio e parcelas — são
carregados uma vez e não são atualizados quando o pedido muda no ERP.** Quem edita um pedido no
Alvo depois que o Hub carregou o detalhe deixa o Hub num estado misto: cabeçalho novo, filhos
velhos. E o mais perigoso é que **o cabeçalho continua batendo** — a divergência é invisível em
qualquer conferência de totais.

### Caso completo: pedido 0004495

Histórico dos payloads crus do próprio Hub (`compras_pedidos_auditoria`):

| payload | cabeçalho | item seq | qtd | unitário | total do item |
|---|---:|---:|---:|---:|---:|
| 23/07 11:07 → 28/07 09:00 (6 payloads) | 110.000 | 1 | 2 | 55.000 | 110.000 |
| **13/08 11:00 → 27/08 12:01 (3 payloads)** | **55.000** | **2** | **18** | **3.055,5555** | **55.000** |

O pedido foi alterado no ERP entre 28/07 e 13/08. O que o Hub tem **hoje**:

| | Hub | Alvo (payload atual) |
|---|---|---|
| `valor_total` (cabeçalho) | 55.000 ✅ | 55.000 |
| item: sequência | **1** ❌ | 2 |
| item: quantidade | **2** ❌ | 18 |
| item: valor unitário | **55.000** ❌ | 3.055,5555 |
| item: valor total | **110.000** ❌ | 55.000 |
| parcelas | **36** ❌ | 18 |
| rateio (linhas) | **1** ❌ | 2 |

**R$ 55.000 de valor fantasma em um único pedido**, e ninguém veria olhando o total.

---

## B1 — Prova de fogo: 5 pedidos, campo a campo

Seleção conforme pedido: criado no Hub × descoberto pelo sync; multi-CC × sem rateio; com
parcelas e anexo.

| pedido | origem | perfil | resultado |
|---|---|---|---|
| **0004795** | Hub | multi-CC (3 CCs), 1 item, 1 parcela | ✅ **tudo bate** |
| **0004776** | sync | 1 item, rateio, 3 parcelas | ✅ valores, itens, rateio e 3/3 parcelas batem |
| **0004769** | Hub | 3 itens, 3 anexos | ⚠️ itens e rateio batem; **vencimento da parcela diverge** |
| **0004495** | Hub | 36 parcelas, 1 anexo | ❌ **detalhe congelado** (tabela acima) |
| **0004815** | sync | sem rateio (CC no cabeçalho) | ❌ **vazio no Hub**: 0 itens, 0 parcelas, 0 rateio |

### Cabeçalho — 7 campos de valor, 5 de 5 pedidos

`valor_total`, `valor_mercadoria`, `valor_servico`, `valor_frete`, `valor_ipi`,
`valor_outras_despesas`, `valor_desconto`: **"ok" em todos os 30 pares comparados.**
`codigo_entidade`, `nome_entidade`, `status`, `aprovado`: idem.
**A soma dos componentes fecha com `valor_total` em 5 de 5.**

### O `centro_custo` do cabeçalho não vem do cabeçalho do Alvo

| pedido | `CodigoCentroCtrl` no Alvo | `centro_custo` no Hub | CCs no rateio |
|---|---|---|---|
| 0004495 | **(nulo)** | 00008.00002.00005 | **00008.00001.00005** ← diferente! |
| 0004769 | (nulo) | 00010.00002.00002 | 00010.00002.00002 |
| 0004776 | (nulo) | 00010.00002.00007.00002 | 00010.00002.00007.00002 |
| 0004795 | (nulo) | 00010.00002.00001 | **3 CCs** (só o 1º aparece no cabeçalho) |
| 0004815 | 00010.00001.00005 | 00010.00001.00005 | (sem rateio) |

Em 4 de 5, o Alvo **não traz CC no cabeçalho** — o Hub preenche por derivação. Duas
consequências: no `0004495` o cabeçalho aponta um CC **diferente** do rateio; no `0004795`, um
pedido rateado entre 3 CCs aparece inteiro sob um só. É a mesma armadilha LIVRO × ESPELHO do
CLAUDE.md: filtrar "gasto por CC" pelo cabeçalho dá um número plausível e errado.

### Parcelas: valor bate, vencimento não

Pedido 0004769, parcela 1: valor **R$ 1.178 nos dois**, vencimento **01/08/2026 no Alvo** e
**27/08/2026 no Hub** — 26 dias de diferença (não é fuso horário).

---

## B2 — A comparação estendida à população

```sql
-- 1.343 pedidos com payload cru; comparação contra o payload mais recente de cada um
select count(*), count(*) filter (where round(hub_cab,2)=round(alvo_cab,2)) ...
```

| conferência | resultado |
|---|---|
| **`valor_total` do cabeçalho bate** | **1.343 de 1.343 — 100%** |
| cabeçalho diverge | **0** |
| quantidade de itens diverge | 55 pedidos |
| pedidos sem nenhum item no Hub (Alvo tem) | 31 |
| **soma dos itens diverge** | **41 pedidos** |
| **valor total divergente nos itens** | **R$ 411.694,55** |

### Onde a divergência se concentra — e a prova do mecanismo

| mês do pedido | pedidos divergentes | valor divergente | com detalhe mais velho que o payload |
|---|---:|---:|---:|
| 2026-03 | 3 | 117.597,00 | 0 |
| 2026-04 | 2 | 2.889,00 | 1 |
| 2026-05 | 1 | 195,50 | 1 |
| 2026-07 | 13 | 56.090,70 | 9 |
| **2026-08** | **22** | **234.922,35** | **22 de 22** |

Em agosto, **100% dos pedidos divergentes têm `detalhes_carregados_em` anterior ao payload mais
recente** — o pedido mudou no ERP depois que o Hub carregou o detalhe, e o Hub nunca recarregou.
A tendência é de **piora em volume** (3 → 22 casos/mês), acompanhando o crescimento do módulo.

### Parcelas na população

| conferência | resultado |
|---|---|
| parcelas comparáveis | 1.307 |
| **valor da parcela diverge** | **85 (6,5%)** |
| **data de vencimento diverge** | **84 (6,4%)**, em **40 pedidos** |

---

## B3 — O que falta hoje, por período (atualiza a medição de 03/09)

| mês | pedidos | itens | **rateio** | parcelas | CC | classe | CNPJ | cond. pag. | 1º venc. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-03 | 195 | 100% | 18,5% | 18,5% | 99,0% | 100% | 95,9% | 25,6% | 100% |
| 2026-04 | 214 | 98,6% | 21,5% | 21,0% | 53,7% | 38,8% | 35,5% | 22,0% | 38,3% |
| 2026-05 | 187 | 97,3% | 26,7% | 26,7% | 74,3% | 73,8% | 62,0% | 74,9% | 73,8% |
| 2026-06 | 233 | 97,9% | 24,9% | 25,3% | 54,5% | 37,8% | 25,3% | 39,5% | 37,8% |
| 2026-07 | 214 | 97,7% | 48,1% | 46,7% | 63,6% | 57,0% | 41,1% | 58,9% | 55,6% |
| **2026-08** | 228 | 96,1% | **86,8%** | 85,5% | 86,4% | 85,1% | 84,2% | 89,5% | 83,8% |
| 2026-09 | 54 | 88,9% | **87,0%** | 87,0% | 88,9% | 85,2% | 85,2% | 90,7% | 85,2% |

**Tendência: melhora forte e consistente.** O rateio saiu de 18,5% para 87%; o
`ESTADO-SYNC-PEDIDOS` registrava 72% para o coorte ago/set em 03/09 — subiu **15 pontos**, o que
é compatível com o efeito medido da S1.1 (+230 linhas de rateio nos 6 ciclos de 07/09).

Setembro tem `itens` e `detalhe` mais baixos (88,9% / 87,0%) porque os pedidos mais recentes
ainda estão na fila do Job 2 — coerente com a mediana de 18 h para o detalhe carregar.

---

## B4 — Os 140 presos em `enviado_alvo`: é só o rótulo

| conferência | resultado |
|---|---|
| total | 140 |
| com `detalhes_carregados` | **140** |
| com itens | **140** |
| com rateio | **140** |
| com parcelas | **140** |
| com status do Alvo | **140** |
| **ressincronizados depois do envio** (`synced_at > enviado_em`) | **140** |
| com número real (não `RASCUNHO-`) | **140** |
| com CC / classe | 123 |
| com CNPJ | 136 |

**O dado está completo e o sync continua tratando-os normalmente.** O `status_local` não migra
para `sincronizado`, mas isso não afeta nada além da aparência na lista. As lacunas de CC/classe
(17 casos) são as mesmas da base geral, não específicas desse grupo. **Cosmético — confirmado
por medição, não por suposição.**

---

## O que contradisse o meu próprio discovery

1. **"O sync é confiável" precisa de qualificação.** Eu havia medido que o cron roda (686
   ciclos, 0–2% de erro) e que 96,6% dos pedidos ganham detalhe — e classifiquei o sync como
   confiável, em (c) ruído/percepção. **Isso vale para o cabeçalho, não para o detalhe.**
   Cobertura mede o que está nulo; só a comparação campo a campo revela o que está errado — e
   41 pedidos com R$ 411 mil de diferença estavam invisíveis em toda métrica que usei antes.
2. **`centro_custo` não é um campo espelhado.** Tratei-o como dado do pedido; é derivado, e o
   Alvo em geral nem o preenche no cabeçalho. Em pedido multi-CC ele é enganoso por construção.
3. **A latência de 18 h para o detalhe é mais séria do que "higiene".** Ela não é só espera: o
   detalhe que chega depois **não é reconciliado**, então o atraso vira divergência permanente
   se o pedido for editado no ERP nesse intervalo.

---

## B6 — Dissecação dos 41 divergentes (08/09/2026, investigação dirigida)

### B6.1 Duas comparações diferentes — só uma é defeito

A conferência original comparou **soma dos itens do Hub × soma dos itens no payload do Alvo**.
Isso é diferente de comparar **itens × cabeçalho**, e a distinção importa:

| comparação | resultado | é defeito? |
|---|---|---|
| soma dos **itens × cabeçalho** do mesmo documento | difere com frequência | **NÃO** |
| soma dos **itens do Hub × itens do Alvo** | difere em 41 pedidos | **SIM** |

**Itens × cabeçalho não fecha por construção:** o cabeçalho carrega frete, IPI e outras despesas
que não estão nos itens. Testado nos 17 pedidos em que o Alvo não fecha com o próprio cabeçalho —
**15 são integralmente explicados** por `valor_frete + valor_ipi + valor_outras_despesas`:

| pedido | itens (Alvo) | frete | IPI | outras | soma | cabeçalho |
|---|---:|---:|---:|---:|---:|---:|
| 0004635 | 6.241,86 | 242,86 | — | — | **6.484,72** | 6.484,72 ✅ |
| 0004539 | 1.476,00 | 175,00 | — | — | **1.651,00** | 1.651,00 ✅ |
| 0004757 | 302,50 | 151,44 | — | — | **453,94** | 453,94 ✅ |
| 0003862 | 1.078,80 | — | 90,58 | — | **1.169,38** | 1.169,38 ✅ |
| 0003468 | 2.100,00 | — | — | 68,25 | **2.168,25** | 2.168,25 ✅ |
| 0003095 | 1.020,00 | 20,63 | 33,82 | — | **1.074,45** | 1.074,45 ✅ |

Só 2 não fecham, e por valores pequenos: `0003360` (R$ 6,70) e `0003766` (R$ 139). **Ninguém deve
tratar "itens ≠ cabeçalho" como erro.**

### B6.2 O erro é do HUB — o Alvo é internamente consistente

Esta é a pergunta que decide se há o que corrigir. Resposta: **há**.

| conferência | pedidos | % |
|---|---:|---:|
| **Alvo fecha consigo mesmo** (soma dos itens do Alvo = cabeçalho) | **32 de 41** | **78%** |
| Alvo não fecha, mas fecha somando frete/IPI/outras | 9 de 41 | 22% |
| **Alvo traz a divergência** | **0** | **0%** |

Em nenhum dos 41 o ERP está inconsistente. **Quem diverge é o Hub, sempre.**

### B6.3 O mecanismo, provado no pedido 0004554

Histórico dos payloads crus do próprio Hub:

| payload | itens no Alvo | cabeçalho no Alvo |
|---|---:|---:|
| 29/07 17:00 → 31/07 17:00 (3 payloads) | **14** | 116.549,60 |
| **03/08 11:00 → 19/08 13:01 (7 payloads)** | **7** | **66.044,76** |

Sete itens foram **excluídos no ERP** em 03/08. O que o Hub tem hoje:

| | Hub | Alvo |
|---|---:|---:|
| cabeçalho | 66.044,76 ✅ | 66.044,76 |
| itens (contagem) | **14** ❌ | 7 |
| itens (soma) | **116.549,60** ❌ | 66.044,76 |

Os 14 itens do Hub são produtos **distintos** (`001.007.00002` … `001.007.00038`), todos criados
no mesmo instante (29/07 17:00:33) — não é duplicação de linha, são os 7 itens excluídos que
**nunca foram removidos**.

> **Conclusão: o Hub nunca remove item que sumiu do ERP, e nunca atualiza item que mudou.
> Só insere o que falta.** O cabeçalho é reescrito a cada ciclo; os filhos, não.

### B6.4 Os três mecanismos e onde o valor se concentra

| mecanismo | pedidos | valor |
|---|---:|---:|
| **C) mesma contagem, valores diferentes** (item alterado no ERP) | 24 | R$ 225.665,84 |
| **A) Hub tem MAIS itens** (excluídos no ERP, vivos no Hub) | 11 | R$ 181.506,63 |
| **B) Hub tem MENOS itens** (itens novos não carregados) | 6 | R$ 4.522,08 |

| corte | pedidos | valor |
|---|---:|---:|
| pedidos anteriores a 24/05 | 5 | R$ 120.486,00 |
| **pedidos posteriores a 24/05** | **36** | **R$ 291.208,55** |
| criados no Hub | 9 | R$ 217.108,61 |
| descobertos pelo sync | 32 | R$ 194.585,94 |

**O coorte 24/05 não protege** (36 dos 41 são posteriores) e **a origem não discrimina** —
acontece nos dois caminhos. O que discrimina é o pedido **ter sido editado no ERP depois da carga
do detalhe**: 33 dos 41 (80%) têm `detalhes_carregados_em` anterior ao payload mais recente.

### B6.5 Não é sync degradado — são pedidos completos

| conferência | resultado |
|---|---|
| com `detalhes_carregados = true` | **41 de 41** |
| completos (detalhe + rateio + parcelas) | 32 de 41 |
| com detalhe anterior ao payload | 33 de 41 (80%) |

Nenhum é caso de carga interrompida. São pedidos **completos, com valores errados** — que é
exatamente o que nenhuma métrica de cobertura consegue ver.

### B6.6 Os 18 maiores (99% do valor)

| pedido | data | origem | cabeçalho | itens Hub | itens Alvo | diferença |
|---|---|---|---:|---:|---:|---:|
| 0004586 | 03/08 | Hub | 48.750,00 | 191.795,42 | 48.750,00 | **+143.045,42** |
| 0003681 | 31/03 | sync | 61.000,00 | 122.000,00 | 61.000,00 | +61.000,00 |
| 0003682 | 31/03 | sync | 55.848,00 | 111.696,00 | 55.848,00 | +55.848,00 |
| 0004495 | 25/08 | Hub | 55.000,00 | 110.000,00 | 55.000,00 | +55.000,00 |
| 0004554 | 29/07 | sync | 66.044,76 | 116.549,60 | 66.044,76 | +50.504,84 |
| 0004674 | 14/08 | Hub | 62.100,00 | 48.600,00 | 62.100,00 | −13.500,00 |
| 0004582 | 03/08 | sync | 51.799,85 | 60.864,81 | 51.799,85 | +9.064,96 |
| 0004715 | 20/08 | Hub | 495,00 | 4.950,00 | 495,00 | +4.455,00 |
| 0004756 | 25/08 | sync | 11.709,10 | 8.185,00 | 11.709,10 | −3.524,10 |
| 0003732 | 07/04 | sync | 2.750,00 | 5.500,00 | 2.750,00 | +2.750,00 |
| 0004755 | 25/08 | sync | 599,68 | 2.998,40 | 599,68 | +2.398,72 |
| 0004539 | 28/07 | sync | 1.651,00 | 3.600,00 | 1.476,00 | +2.124,00 |
| 0004413 | 10/07 | sync | 21.585,50 | 23.495,00 | 21.585,50 | +1.909,50 |
| 0004757 | 25/08 | sync | 453,94 | 1.375,00 | 302,50 | +1.072,50 |
| 0004742 | 25/08 | Hub | 1.060,90 | 116,69 | 1.060,90 | −944,21 |
| 0003669 | 31/03 | sync | 749,00 | 1.498,00 | 749,00 | +749,00 |
| 0004679 | 17/08 | sync | 2.623,35 | 3.184,00 | 2.547,20 | +636,80 |
| 0004559 | 30/07 | sync | 1.501,51 | 2.044,80 | 1.479,90 | +564,90 |

**Os cinco primeiros concentram R$ 365.398,26 — 89% do total.** Os 23 restantes (`0004670`,
`0004525`, `0004481`, `0004638`, `0004066`, `0004521`, `0004635`, `0004611`, `0003766`,
`0004720`, `0004546`, `0004704`, `0004752`, `0004567`, `0004658`, `0004564`, `0004595`,
`0004533`, `0004685`, `0004732`, `0004498`, `0004758`, `0004511`) somam menos de R$ 3 mil,
com diferenças individuais de R$ 5 a R$ 380.

### B6.7 🔴 O gate da S1.1 não pega NENHUM destes 41

O gate corrigido pela S1.1 decide reprocessar por **evidência direta de ausência**: "o Alvo tem
rateio de item e o Hub não tem" (§9.1). **Todos os 41 já têm itens e 32 já têm rateio** — para o
gate, estão satisfeitos, e nunca voltam à fila.

**O critério que falta é de FRESCURA, não de presença.** Um pedido precisa ser revisitado quando
o que o Hub guarda **diverge** do que o Alvo devolve, não apenas quando falta. Sinais baratos,
todos já disponíveis no payload que o Job 2 tem em mãos:

- contagem de itens do payload ≠ contagem no Hub;
- soma de `ValorTotal` dos itens do payload ≠ soma no Hub;
- `valor_total` do cabeçalho mudou desde a última carga do detalhe.

E a reconciliação precisa **remover** item que sumiu do Alvo — hoje nenhum caminho do Hub faz
isso, e é a origem dos R$ 181,5 mil do mecanismo A.

---

## Recomendação (fora do escopo desta sessão)

A correção de fundo é **reconciliar o detalhe por frescura, não por presença** — dissecada na
§B6.7, com os 41 casos abertos um a um. Duas partes, e a segunda não existe em lugar nenhum do
Hub hoje: (a) revisitar o pedido quando contagem ou soma dos itens divergir do payload;
(b) **remover item que sumiu do Alvo**.

Isso conversa diretamente com o desenho da FASE S2 (`ESTADO-SYNC-PEDIDOS` §10): o backfill por
jsonb tem 9,5% de dado desatualizado pelo mesmo motivo. **É o mesmo defeito, medido por dois
caminhos independentes.**
