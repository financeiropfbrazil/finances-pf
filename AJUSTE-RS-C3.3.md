# AJUSTE-RS-C3.3 — Regras de normalização de rateio, derivadas de Loads ao vivo
### Ajuste aos cards C3/C3.2 (pedidos) e R1.2 (requisições)

> **Documento aditivo.** Não altera `AJUSTE-RS-C3.md` nem `AJUSTE-RS-C3.1.md` — os dois
> continuam válidos. Onde houver conflito com a validação hoje implementada, **este
> arquivo prevalece**.
>
> **Base factual:** varredura sistemática do Codex (24/08, leitura pura, matriz de formas
> sobre 1.211 Loads auditados) + **Loads ao vivo** de 8 pedidos anômalos, capturados pelo
> gateway em 24/08 e analisados campo a campo.
>
> **Por que este documento existe:** as duas normalizações anteriores nasceram de UM caso
> cada e, em 24h, uma delas quase virou uma correção errada. A varredura provou que os
> documentos que falham **não têm causa comum** — são quatro famílias distintas, e uma
> delas não deve ser normalizada de jeito nenhum.

---

## 1. As quatro famílias (evidência de Load ao vivo)

| Família | Pedidos | O que acontece | Tratamento |
|---|---|---|---|
| **F1 — arredondamento decimal** | 0004371, 0004402, 0004691 | Percentuais desviam na 4ª casa (99,9999 / 100,0001). **Os valores fecham exatos.** | Tolerância + residual |
| **F2 — percentual ausente, valor presente** | 0004476, 0004471 | Percentual nulo ou zero, mas o valor permite reconstruir | Derivar do valor / da estrutura |
| **F3 — sem informação recuperável** | 0004500 | 6 CCs, **todos** com percentual nulo e sem valores | **Falhar** — contador de tentativas |
| **F4 — item mutilado, cabeçalho íntegro** | 0004098, 0004495 | O item perdeu ou corrompeu o percentual; o cabeçalho está correto | Fallback de cabeçalho, **marcado** |

### Evidência por família

**F1.** `0004371`: 3 CCs a 33,3333% → 99,9999; valores 80+80+80 = R$ 240 = `ValorTotal`.
`0004402`: classes do item somam 100,0001, cabeçalho soma 100,0. `0004691`: classe 15.02
com 7 CCs somando 99,9999 **e** as 4 classes somando 99,9999 — falha nos dois níveis.

**F2.** `0004476`: classe 15.02 com 3 CCs, um deles `Percentual: null`; os conhecidos somam
39,1886, residual 60,8114. Conferência independente pelo valor: `6.247,44 / 10.273,47 =
60,8114` exato. `0004471` item seq 1: CC **único** com `Percentual: 0` e `Valor: 0`, num
item de R$ 65,78 — os outros 8 itens do mesmo pedido têm o mesmo CC a 100%.

**F3.** `0004500`: classe 12.07 a 100%, com **6 CCs, todos `Percentual: null`**, sem valores.
Dividir R$ 635 entre seis centros exigiria inventar a proporção.

**F4.** `0004098`: classe 15.01 vale **37,6823%** no cabeçalho e **5,6896%** no item; as
outras duas classes coincidem. Classes do item somam **68,0075%** — faltam R$ 16.063 de
alocação. O cabeçalho soma 100% e os valores batem com o `ValorTotal` de R$ 50.208,50.
`0004495`: item com `Percentual: 15151,5152` (= 55.000 / 363 — o Alvo calculou contra base
errada), CCs fechando 100% e valor correto; cabeçalho com 100% limpo.

---

## 2. Regras (hierarquia de resolução)

### C3.3-A — Ordem de fontes: item → cabeçalho → falha
1. **Item** continua sendo a fonte canônica (mantém o C3-A).
2. Se o rateio do item **não fechar** após aplicadas as regras B, C e D, tentar o
   **cabeçalho** (`PedCompClasseRecDespChildList`).
3. Se o cabeçalho fechar, usar **e marcar a origem**.
4. Se nenhum dos dois fechar, **falhar explicitamente** — sem gravar rateio parcial.

⚠️ **Restrição do fallback de cabeçalho:** só se aplica a pedido de **item único**. Com
múltiplos itens, o rateio de cabeçalho é do documento inteiro e não há base para atribuir
por item — nesse caso, falhar. (Os dois casos F4 medidos são de item único.)

### C3.3-B — Tolerância de arredondamento (F1)
Aceitar soma no intervalo **100,0000 ± 0,01** em qualquer nível, com o **residual aplicado
na última linha** para fechar exatamente 100,0000 no que é gravado. Fora desse intervalo,
não é arredondamento — segue para as regras seguintes ou falha.

### C3.3-C — Reconstrução por valor (F2)
Quando **exatamente um** percentual estiver ausente (`null`) num grupo e houver valores:
derivar `percentual = valor_da_linha / valor_da_classe × 100`, arredondado a 4 casas.
Validado no 0004476 (resultado idêntico ao residual).
Quando **mais de um** estiver ausente, não derivar — cai na C3.3-E.

### C3.3-D — Grupo de linha única (F2)
Linha **única** num grupo, com percentual `null` ou `0` → assume **100**. É aritmeticamente
necessário: não há o que dividir. Vale para os dois níveis (classe única no item; CC único
na classe).
🔴 **Não confundir com fatia zero em grupo múltiplo.** Nos pedidos **0004052 e 0004053**
existem CCs a 0% dentro de rateios que **já somam 100** — são deliberados e **não** podem
ser convertidos. A regra só se aplica quando a linha é a única do grupo.

### C3.3-E — Falha explícita (F3)
Vários percentuais ausentes sem valores que permitam reconstrução → **falhar**, sem
normalizar. Não inventar divisão. Esses documentos precisam do **contador de tentativas**
(pendência aberta desde o C3), senão reentram na fila indefinidamente.

### C3.3-F — Marcação de origem
Coluna nova em `compras_pedidos_itens_rateio` (e equivalente em requisições):
`origem_rateio` — `'item'` (normal) | `'cabecalho'` (fallback C3.3-A).
Sem a marca, o Hub estaria "consertando" em silêncio. Com ela, é possível listar e auditar
os documentos derivados a qualquer momento.

### C3.3-G — Preservar `null` distinto de `0`
O extrator **não pode** converter `null` em `0` antes de enviar à RPC (hoje faz isso —
`sync-compras-status-cron/index.ts`, no ponto que o discovery localizou). São casos
diferentes: `null` é ausência (recuperável pela C3.3-C/D), `0` pode ser deliberado (0004052).

---

## 3. O problema silencioso — falso-negativo

A varredura achou algo **pior** do que os documentos que falham ruidosamente: **8
documentos com item ativo passam pela validação sem erro** porque nenhuma linha chega à
RPC — 3 itens sem classe e 5 classes sem CC. Eles são marcados como completos e ficam
invisíveis, sem rateio e sem alarme.

Regra: **"nenhuma linha extraída" ≠ "detalhe completo"**. Item ativo (`Cancelado ≠ Total`)
sem classe, ou classe sem CC, é **estrutura incompleta** e deve ser registrado como tal —
não silenciosamente aceito.

*(Dos 31 pedidos com rateio inteiro vazio, 23 tinham só itens cancelados — situação
legítima. Os outros 8 são o problema.)*

---

## 4. Contradições que a varredura estabeleceu

1. **P3 caiu como regra universal.** "Cabeçalho e itens somam o mesmo total" vale para os
   casos inspecionados, mas há **98 contraexemplos** em 996 Loads comparáveis.
2. **`compras_pedidos_itens_rateio.percentual` tem DUAS semânticas históricas.** No legado
   anterior ao C3, o percentual é achatado (classe de 50% gravada como um CC de 50%); nas
   linhas novas, é o percentual do CC dentro da classe. **Qualquer relatório que some essa
   coluna mistura as duas.** 10 grupos em 5 pedidos (0004026, 0004060, 0004228, 0004269)
   têm soma ≠ 100 por esse motivo.
3. **`sync_runs.total_erros` não conta as falhas de rateio** — o catch registra em
   `detalhes` mas não incrementa o contador. Por isso os ciclos aparecem com "0 erros"
   tendo falhas dentro.
4. **Requisições: zero evidência de rateio real.** Todos os payloads auditados têm
   `ReqCompClasseRecDespChildList: []`. A única forma conhecida é o teste controlado
   0001445. As regras acima **valem por analogia** para requisições, e precisam ser
   revalidadas quando houver caso real.

---

## 5. Perguntas em aberto

1. O legado com percentual achatado (item 2 da §4) entra em relatório com corte de data,
   ou precisa de migração própria?
2. A tolerância de ±0,01 vale também para a RPC de **requisições** (hoje mais estrita que a
   de pedidos: rejeita null, zero ou negativo em qualquer CC)?
3. Os 8 documentos de estrutura incompleta (§3) devem aparecer em alguma tela, ou basta
   consulta sob demanda?
4. Um documento que falha por C3.3-E deve parar de ser tentado após N ciclos — qual N, e
   como ele volta à fila depois de corrigido no ERP?

---

## 6. Ordem de implementação sugerida

1. **C3.3-G** (parar de converter null em 0) — pré-requisito de tudo.
2. **C3.3-B** (tolerância) — resolve F1, 3 dos 8 pedidos, sem risco.
3. **C3.3-D** + **C3.3-C** (linha única e reconstrução por valor) — resolve F2.
4. **C3.3-F** + **C3.3-A** (marcação e fallback de cabeçalho) — resolve F4.
5. **§3** (estrutura incompleta deixa de passar em silêncio).
6. **Contador de tentativas** — contém F3 e o 0004370 (404 permanente desde julho).

---

*Ajuste v1.0 — 24/08/2026. Deriva de matriz de formas + 8 Loads ao vivo, não de caso
isolado. Próxima alteração = `AJUSTE-RS-C3.4.md`.*
