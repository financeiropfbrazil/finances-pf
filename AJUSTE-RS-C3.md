# AJUSTE-RS-C3 — Rateio: fonte canônica, valor em reais e regra de validação
### Ajuste ao `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` (CARD C3) e à `MISSAO-SYNC-PEDIDOS.md` (§4.2, §5-A)

> **Documento aditivo.** Não altera o plano v1.1 nem a MISSAO-SYNC-PEDIDOS — as duas
> permanecem como estão. Onde houver conflito, **este arquivo prevalece para o C3**.
> **Base factual:** payloads reais capturados em 19/08/2026 via Laboratório de API e
> DevTools (produção), listados na §1. Nada aqui é inferência de documento.

---

## 1. Evidência (o que foi medido, não relatado)

| Fonte | Pedido | O que provou |
|---|---|---|
| `PedComp/Load` | **0004640** | Rateio existe nos dois níveis com campo `Valor` em reais. Rateio do item = valor do item **+ IPI** (R$ 69.353,42 vs item R$ 60.307,32; delta = IPI R$ 9.046,10). |
| `PedComp/Load` | **0003625** | Cabeçalho e item somam **o mesmo total** (R$ 48.379,82). Divergência de centavos ocorre **dentro de cada classe** e se compensa entre classes (15.01: 10.372,59 × 10.372,56; 15.02: 38.007,23 × 38.007,26). Percentuais fecham 100,0000 em cada nível. |
| `obj` do `insert-multipart` (DevTools) | **0004706** | O Hub **já envia os dois níveis**: `ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[]` **e** `PedCompClasseRecDespChildList[].RateioPedCompChildList[]`. |
| `PedComp/Load` | **0004705 / 0004706** | O Alvo devolve os dois níveis preenchidos e coerentes; `CodigoCentroCtrl` do cabeçalho volta **null**. |

---

## 2. Decisões (substituem as pendências correspondentes do CDX-2 §5)

### C3-A — Fonte canônica: **rateio do ITEM**
`ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[]`.
Razões medidas: mesmo total do cabeçalho (não há perda), granularidade maior (agrega para
cima, o contrário não), e é o nível que a tabela de destino (`compras_pedidos_itens_rateio`,
indexada por `item_id`) já espera. O rateio de cabeçalho passa a ser **ignorado** pelo sync.
> Responde a pergunta 2 do CDX-2 ("rateio canônico: cabeçalho ou item?").

### C3-B — Gravar o **`Valor` em reais** que o Alvo manda
Adicionar coluna `valor numeric` em `compras_pedidos_itens_rateio` e persistir o `Valor` de
cada linha de `RateioItemPedCompChildList`. Hoje ele é descartado e o Hub guarda só o
percentual achatado `round2(cls.percentual * cc.percentual / 100)` — origem do 100,02% que
o S0 mediu no 0003625.
Com o valor original, a soma fecha **por construção**: são os centavos que o Alvo já
calculou. O percentual continua existindo para telas, com 4 casas, mas vira **derivado**.
> Responde as perguntas 4 e 5 do CDX-2 ("residual com 4 casas?" e "coluna valor?").

### C3-C — Preservar os **dois níveis da hierarquia**, não achatar
O Alvo estrutura: item → classe (`Percentual` da classe no item) → CC (`Percentual` do CC
dentro da classe). A tabela já tem `codigo_classe_rec_desp`: gravar **uma linha por
(item, classe, CC)** com o percentual **do próprio nível** (o do CC dentro da classe), não o
produto das duas. Sem mudança de schema além da coluna do C3-B.
Prova: no 0003625, cada classe soma 100,0000 dos seus CCs e as classes somam 100,0000 entre
si; o produto arredondado é que estoura.

### C3-D — Validação da RPC: contra o **total do item com impostos**
`sync_replace_filhos_pedido` **não** deve validar `soma(rateio) == ValorTotal do item`.
Medido no 0004640: o rateio inclui o IPI. Regra:
- **Validação primária:** `sum(percentual)` por (item, classe) = 100,0000 (4 casas) e
  `sum(percentual)` das classes do item = 100,0000.
- **Validação de valor:** `sum(valor)` do item = `ValorTotal + ValorIPI + demais acréscimos
  do item`, com tolerância de **R$ 0,02 por item** (a divergência medida é de arredondamento
  do Alvo, não do Hub). Divergência acima disso = registrar em `sync_runs`, **não** falhar o
  pedido inteiro.
- **Nunca** recalcular ou "corrigir" o valor vindo do Alvo. O Hub espelha, não arbitra.

### C3-E — `compras_pedidos.centro_custo` não é fonte de relatório por CC
Confirmado: o Alvo devolve `CodigoCentroCtrl` do cabeçalho **null** (0004705/0004706); o
valor que existe no Hub vem do `/ped-comp/list` e corresponde à **primeira fatia do primeiro
rateio** — no 0003625 apontaria um CC de 3,4% enquanto o dominante tem 41,2%.
Decisão: **não alterar** o que está gravado (mexer piora), mas:
1. Qualquer visão de gasto por CC passa a ler `compras_pedidos_itens_rateio`.
2. O bloco "completar ausentes" do C3 **pode** preencher a coluna quando nula (compatibilidade
   de tela), mas **jamais** tratá-la como verdade agregada.
3. Corrige a §C1 do `DISCOVERY-FASE7A.md`, que usa essa coluna como 2ª fonte da cascata — os
   percentuais de cobertura de lá estão superestimados na parte apoiada nela.

### C3-F — Envio do Hub: **nada a corrigir**
Medido no `obj` do 0004706: o Hub já envia rateio por item **e** por cabeçalho, com os
placeholders `-1` que o Alvo resolve pelo aninhamento. Cai a hipótese de mudar o envio para
"só item". Permanece apenas o **card D4** do plano (aplicar residual também no rateio interno
do item), que só se manifesta com múltiplos itens.

---

## 3. Impacto nos documentos existentes

| Documento | Trecho afetado | O que muda |
|---|---|---|
| `MISSAO-SYNC-PEDIDOS.md` | §4.2 (matriz), §5-A (mapeamento) | Fonte canônica definida (item); campo `valor` incluído; percentual por nível |
| `MISSAO-SYNC-PEDIDOS.md` | §4.1 S0-1 (UNIQUE) | Já revogado pelo plano v1.1 (D2). Reforçado: sem chave natural, delete+reinsert transacional |
| `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` | CARD C3, PROMPT C3 | Acrescenta C3-A..F; a RPC valida percentual, não valor puro do item |
| `DISCOVERY-FASE7A.md` | §C1 | Cobertura por CC superestimada onde usa `compras_pedidos.centro_custo` |
| `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` | achado das duas fontes divergentes | Refinado: divergem **por classe**, não no total |

---

## 4. SQL — coluna `valor` (preview → apply → verify)

**PREVIEW** (conferir schema atual antes — regra 4 do plano):
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='compras_pedidos_itens_rateio'
order by ordinal_position;
```
**APPLY** (só se a coluna não existir):
```sql
alter table public.compras_pedidos_itens_rateio
  add column if not exists valor numeric;
```
```sql
NOTIFY pgrst, 'reload schema';
```
**VERIFY** (sucesso: coluna presente; linhas antigas com `valor` nulo é esperado — o
backfill preenche):
```sql
select count(*) as linhas, count(valor) as com_valor
from public.compras_pedidos_itens_rateio;
```

---

## 5. Perguntas que continuam abertas (só o Pedro decide)

1. **`IntegradoFinanceiro`**: o 0004705 voltou `"Sim"` e o 0004706 `"Não"` — pedidos quase
   idênticos, 5 min de diferença, campo **não enviado** pelo Hub em nenhum dos dois. A única
   variável visível é a condição de pagamento (0000014 × 0000016). Se o campo controla a
   geração do financeiro, entender o critério do Alvo **antes** que apareça em pedido real.
2. **`PedCompUserFieldsObject`** (relevante para o card D3): o Hub envia `{}` e o Alvo devolve
   preenchido, com `UserProximoAprovador` definido pelo workflow dele. Se o Hub gravar o uuid
   num campo livre desse objeto, o Alvo **preserva ou sobrescreve**? Exige teste dedicado
   antes de fechar o desenho da idempotência.
3. **Aposentadoria dos jsonb** (`classe_rateio`, `itens`, `parcelas`) — inalterada: depois de
   S1/S2 estáveis e telas migradas.
4. **Pedido 0004495** (itens somando o dobro do cabeçalho): segue sem veredito.

---

## 6. Higiene

Cancelar/excluir no Alvo os pedidos de teste **0004705** e **0004706** (ambos R$ 1.000,
BIOCOLLAGEN, marcados "TESTE PEDRO"). Se forem excluídos, o cron os verá como 404 — pela
regra do cross-check, 404 isolado não marca exclusão; conferir que entram como
`excluido_alvo` só com as duas fontes concordando.

---

*Ajuste v1.0 — 19/08/2026. Deriva de evidência de payload, não de documentação. Próxima
alteração = `AJUSTE-RS-C3.1.md`.*
