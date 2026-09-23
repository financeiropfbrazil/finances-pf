# CARD RATEIO-MASSA — Pedido com rateio de centro de custo POR VALOR, em massa, fechando 100,0000%

**Módulo:** Suprimentos → Pedidos (`/suprimentos/pedidos/novo`) · **Data:** 23/09/2026
**Base:** `main` @ `11655ac` · **Autor operacional:** Pedro Scrignoli
**Estado:** código pronto e testado localmente (tipos, testes, build, navegador). **Falta:** aplicar,
publicar no Lovable e fazer o aceite com um pedido-teste no Alvo (§8).
**Banco:** nenhuma mudança — sem migration, sem SQL de escrita. Usa colunas que já existem.

---

## 0. Em uma frase

O operador cola do Excel a lista **"centro de custo + valor em R$"**; o Hub reconhece os centros de
custo, confere que a soma bate com o item e envia ao Alvo **os valores exatamente como digitados**,
com percentuais de 4 casas que somam **100,0000% por construção**, sem resíduo de dízima.

---

## 1. O problema (medido em 23/09/2026)

### 1.1 Hoje o rateio é digitado em %, com 2 casas, e o valor de cada CC é recalculado do %

Com a lista real que motivou o card (R$ 52.350,00 em 19 CCs, com 2.057,14 / 1.521,43 / 171,43):

| Forma | Soma dos % | Soma dos valores que iriam ao Alvo | Pior linha |
|---|---:|---:|---:|
| 2 casas (como é hoje) | **100,02%** — a tela recusa | R$ 52.360,49 | R$ 2,49 de erro |
| 4 casas, arredondando cada linha | 100,0002% | R$ 52.350,09 | 6 linhas fora do centavo |
| **4 casas + maior resto, valor explícito (este card)** | **100,0000%** | **R$ 52.350,00** (os valores digitados) | **0** |

### 1.2 Por que o percentual não pode carregar o valor

Num total de R$ 52.350,00, um passo de 0,0001% vale **R$ 0,05**. Nenhum percentual de 4 casas
devolve R$ 2.057,14 (Corelab): 3,9295% dá R$ 2.057,09 e 3,9296% dá R$ 2.057,15. Logo, **o valor
tem de viajar explícito até o Alvo** — o percentual é informativo.

### 1.3 O que o Alvo faz (medido no espelho e nos jsonb do sync)

| Achado | Evidência |
|---|---|
| Grava `Percentual` com **4 casas** | 33,3333 no 0004371; 88,8894 no 0004691; nenhuma linha do espelho com 5+ casas |
| O próprio Alvo deixa **dízima** quando o pedido nasce nele | 0004371: 3 × 33,3333 = **99,9999**; 0004691, classe 15.02: **99,9999** |
| **Guarda o `Valor` que recebe**, sem recalcular | 0004919 (Hub): o item foi gravado somando **R$ 19.415,03** contra R$ 19.415,04 do item — o caminho do item do Hub não tem ajuste residual (pendência §7.24) |
| Convenção nativa do cabeçalho: classe relativa ao total, **CC relativo à classe** | 0004851 e 0004691 (nascidos no Alvo) |
| O Hub antigo manda CC relativo ao **pedido** no cabeçalho, e o Alvo aceitou | 0004269, 0004871 (multi-classe, criados no Hub) |

---

## 2. A regra de ouro e o método

> 🔴 **O valor em centavos é a verdade. O percentual é consequência.**

- **Valores** são inteiros em centavos. A soma fecha por construção.
- **Percentuais** são inteiros em unidades de 0,0001 ponto percentual (100,0000% = 1.000.000),
  distribuídos pelo **maior resto** (método de Hamilton): cada linha recebe o piso da sua cota; as
  unidades que faltam vão para as maiores frações. Soma = 1.000.000 exatos, e cada linha fica a
  menos de 0,0001 p.p. do percentual exato.
- **Nenhuma soma em ponto flutuante.** Decimal só na saída (payload/tela). Conta em `BigInt`.
- Tudo isso vive num módulo puro, `src/lib/rateioExato.ts`, testado à parte.

### 2.1 O resultado para a lista real

| # | Colado | Centro de custo no Alvo | Valor enviado | % enviado |
|---:|---|---|---:|---:|
| 1 | Almoxarifado/Expedição | 00010.00002.00007.00002 ALMOXARIFADO/EXPEDICAO | 2.250,00 | 4,2980 |
| 2 | Clínico | **escolha** → 00010.00004.00003 ASSUNTOS CLINICOS | 1.800,00 | 3,4384 |
| 3 | Compras | 00010.00002.00007.00001 COMPRAS | 900,00 | 1,7192 |
| 4 | Controladoria/Financeiro | 00010.00002.00003 CONTROLADORIA/FINANCEIRO | 1.800,00 | 3,4384 |
| 5 | Controle da Qualidade | 00010.00003.00002 CONTROLE DA QUALIDADE | 4.500,00 | 8,5960 |
| 6 | Corelab | 00007.00001.00003 CORELAB | 2.057,14 | 3,9296 |
| 7 | Design e Desenvolvimento | 00008.00001.00003 DESIGN E DESENVOLVIMENTO | 7.650,00 | 14,6132 |
| 8 | Diretoria de P&D | 00010.00001.00001 DIRETORIA DE P&D | 450,00 | 0,8596 |
| 9 | Engenharia de Manufatura | 00010.00002.00005 ENGENHARIA DE MANUFATURA | 1.800,00 | 3,4384 |
| 10 | Garantia da Qualidade | 00010.00003.00001 GARANTIA DA QUALIDADE | 1.800,00 | 3,4384 |
| 11 | Gerenciamento de Riscos | 00010.00003.00003 GERENCIAMENTO DE RISCOS | 900,00 | 1,7192 |
| 12 | Laboratório | 00008.00001.00002 LABORATORIO | 900,00 | 1,7192 |
| 13 | Marketing e Comunicação | 00007.00001.00002 MARKETING E COMUNICACAO | 900,00 | 1,7192 |
| 14 | Produção | 00009.00001.00001 PRODUCAO | 17.100,00 | 32,6647 ↓ |
| 15 | Prototipagem | 00008.00001.00001 PROTOTIPAGEM | 3.600,00 | 6,8768 |
| 16 | Recursos Humanos | 00010.00002.00002 RECURSOS HUMANOS | 1.521,43 | 2,9062 ↓ |
| 17 | Regulatórios | **escolha** → 00010.00004.00001 ASSUNTOS REGULATORIOS | 1.350,00 | 2,5788 |
| 18 | TI – Tecnologia da Informação | 00010.00002.00008 TI - TECNOLOGIA DA INFORMACAO | 900,00 | 1,7192 |
| 19 | Engenharia da Qualidade | 00010.00003.00004 ENGENHARIA DA QUALIDADE | 171,43 | 0,3275 |
| | **Total** | | **52.350,00** | **100,0000** |

↓ = as duas linhas de menor fração arredondam para baixo; é o que fecha 100,0000 (o arredondamento
independente daria 100,0002).

---

## 3. O que muda na tela

**Modal do item → "Rateio Classe + CC":**

1. Seletor **"Informar o rateio por: Percentual (%) | Valor (R$)"**. Percentual é o caminho de sempre.
   Trocar para R$ converte os % em valores exatos (se os % fecham 100%); voltar para % converte em
   % de 2 casas, com aviso.
2. Botão **"Colar lista (R$)"** em cada classe. Abre o diálogo de colagem:
   - aceita colagem do Excel (TAB), CSV com `;`, ou "nome  valor" separado por espaços; aceita
     "R$ 17.100,00", "17.100", "17100", "2057.14" (Excel em inglês);
   - **recusa, apontando a linha**, valor com mais de 2 casas (ex.: célula sem arredondar), negativo
     ou ambíguo ("1,234"); cabeçalho, linha de **Total** (conferida contra a soma) e valor zero são
     ignorados e mostrados, nunca descartados em silêncio;
   - casa o nome com `cost_centers` (ativos, grupo F) **só quando o código ou o nome bate exatamente**
     (sem acento, caixa, travessão). Aproximado vira **sugestão** e espera a escolha — "Laboratório"
     nunca vira "LAB PESQUISA" sozinho. Na lista real: 17 automáticos; "Clínico" sugere ASSUNTOS
     CLINICOS / EDUCACAO CLINICA / ESPECIALISTAS CLINICOS; "Regulatórios" sugere ASSUNTOS
     REGULATORIOS / ESTUDO TRICUS - REGULATORIO;
   - mostra o % de cada linha e o total **100,0000%**; CC repetido é somado e sinalizado (UNIQUE do
     Alvo, card D4);
   - **"Aplicar" só libera** com tudo casado, sem erro e com a soma **igual ao total do item**. Com
     quantidade 1, oferece "Usar R$ X como valor do item".
3. No modo valor: campo R$ por CC (ao sair do campo mostra como foi entendido: "2057.14" → "2.057,14"),
   % só de leitura com 4 casas, e o rodapé **"CCs: R$ 52.350,00 de R$ 52.350,00 ✓ 100,0000%"** — ou a
   diferença em vermelho. **Salvar recusa** se não fechar.
4. Chip **"rateio por valor (R$)"** no item (lista e revisão).

**Detalhe do pedido:** quando todas as linhas do item têm valor e fecham o item no centavo, a tela
mostra **o valor gravado** e o **% com 4 casas**, em vez de recalcular valor a partir de % arredondado.

> ⚠️ **Efeito visível também em pedidos antigos (medido em 23/09/2026):** dos 1.179 itens com rateio,
> **992** passam a mostrar o valor gravado do espelho do Alvo (diferença para a conta antiga: centavos)
> e o % com 4 casas; **43** continuam pela conta antiga (rateio contra base com IPI, não fecha o item);
> 144 são linhas antigas sem valor e não mudam. Se preferir restringir, ver decisão D4 (§10).

---

## 4. O que muda no envio (`src/services/pedidosService.ts`)

| Ponto | Mudança |
|---|---|
| Tipos | `ItemPedidoInput.rateio_por_valor?` e `RateioCcInput.valor_centavos?` (opcionais) |
| Validação | item por valor: todo CC com valor > 0 e **soma = total do item, no centavo**; pedido com item por valor exige total do pedido = soma dos itens (só falha com valor unitário de 3+ casas) |
| Payload do item | com ao menos 1 item por valor, **o pedido inteiro** sai pelo caminho exato: valores em centavos, % de 4 casas pelo maior resto (itens por % do mesmo pedido são convertidos pelo maior resto) |
| Payload do cabeçalho | soma exata dos itens em centavos; classes fecham o `ValorTotal` **sem "ajuste na última linha"**; % na convenção do Alvo (CC relativo à classe) |
| Gravação local | `compras_pedidos_itens_rateio` com `valor` + `percentual` relativo à classe (convenção do espelho) — a retomada de rascunho/erro volta **por valor**, com os mesmos centavos |
| Leitura | `montarRateioDoItem` devolve também `valor_centavos` (aditivo) |

> 🔴 **Pedido sem item por valor: nenhuma mudança.** Provado por teste: **5.000 pedidos aleatórios**
> (1–4 itens, 1–3 classes, 1–8 CCs, % quebrados) geram payload **byte a byte igual ao da HEAD**
> (`DataHoraDigitacao` excluída). O resíduo de centavo do caminho por % (§7.24) **não foi tocado** —
> decisão D3 (§10).

---

## 5. Arquivos

| Arquivo | Tipo | O quê |
|---|---|---|
| `src/lib/rateioExato.ts` | **novo** | núcleo puro: maior resto, leitura de R$, leitura da colagem, casamento de CC, rateio exato de item e cabeçalho |
| `src/components/compras/ColarRateioCCDialog.tsx` | **novo** | diálogo "Colar rateio por valor" |
| `src/services/pedidosService.ts` | alterado (aditivo) | §4 |
| `src/pages/SuprimentosPedidoNovo.tsx` | alterado | §3, itens 1–4 |
| `src/pages/SuprimentosPedidoDetalhe.tsx` | alterado | §3, detalhe |
| `src/test/rateio-exato.test.ts` | **novo** | 30 testes (inclui 5.000 casos aleatórios do maior resto) |
| `src/test/rateio-massa-pedido.test.ts` | **novo** | 12 testes do payload (âncora 0004919, lista real, pedido misto, retomada) |
| `src/test/colar-rateio-dialog.test.tsx` | **novo** | 5 testes do diálogo com a lista real |
| `src/test/rateio-massa-wizard.test.tsx` | **novo** | 2 testes na tela real do wizard: colar → escolher → aplicar → salvar → enviar; digitar por valor |
| `CARD-RATEIO-MASSA-PEDIDOS.md` | **novo** | este card |

Os testes de tela usam `react-dom` + `act`, como os do repositório — **sem dependência nova**.

---

## 6. Verificação feita (23/09/2026, clone em `main@11655ac`)

| Verificação | Resultado |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | **limpo** |
| `vitest run` | **174 passam**; 7 falham = `sidebar-ordem.test.tsx`, **idêntico na HEAD** (pré-existente) |
| `vite build` | **limpo** |
| lint | arquivos novos zerados; `pedidosService.ts` **+1** `no-explicit-any` (o `(supabase as any)` padrão do arquivo); os dois `.tsx` alterados iguais à HEAD |
| regressão do caminho antigo | 5.000 pedidos aleatórios → payload idêntico ao da HEAD |
| navegador real (Chromium, dados simulados) | colar → escolher → aplicar → salvar; **retomada pelo carregador real** volta por valor; detalhe mostra R$ 2.057,14 e 3,9296%; sem erro de console |

---

## 7. Como aplicar (PowerShell, no clone local)

```powershell
cd C:\Users\PFBR-2601-3\finances-pf
git remote -v
git branch --show-current
git pull origin main
git log -1 --oneline
```

O `git log` deve mostrar `11655ac`. Se houver commits novos, o `git am` abaixo acusa conflito em vez
de aplicar por cima.

```powershell
git checkout -b rateio-massa
git am --3way "C:\Users\PFBR-2601-3\Downloads\RATEIO-MASSA.patch"
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
npx vitest run src/test/rateio-exato.test.ts src/test/rateio-massa-pedido.test.ts src/test/colar-rateio-dialog.test.tsx src/test/rateio-massa-wizard.test.tsx src/test/rateio-consolidacao-d4.test.ts src/test/rateio-projetos-e-loader.test.ts
bun run build
```

Tudo verde → publicar:

```powershell
git checkout main
git merge --ff-only rateio-massa
git push origin main
```

Depois: conferir o commit no editor do Lovable → **Publish** (manual).

---

## 8. Aceite em produção (antes do uso real)

🔴 A escrita de `Percentual` com 4 casas **pela API** nunca foi exercitada (o Hub sempre mandou 2).
O Alvo grava 4 casas quando o pedido nasce nele, mas isso é prova indireta. **Um pedido-teste
pequeno decide.** Molde dos testes de 27/08 (0004794/0004795/0004797).

**Pedido-teste:** 1 item de serviço, quantidade 1, **R$ 70,00**, duas classes, por valor:

| Classe | CC | Valor | % esperado no Alvo |
|---|---|---:|---:|
| A (classe de teste) | CC 1 | 10,00 | 33,3333 dentro da classe |
| A | CC 2 | 20,00 | 66,6667 dentro da classe |
| B (classe de teste) | CC 3 | 40,00 | 100,0000 dentro da classe |
| | classe A no item | 30,00 | **42,8571** |
| | classe B no item | 40,00 | **57,1429** |

As dízimas de 1/7 e 1/3 são de propósito: é onde arredondamento independente falha.

| # | Conferência | Esperado |
|---|---|---|
| 1 | Envio | 1 tentativa, sucesso, sem erro do Alvo |
| 2 | `compras_pedidos_itens_rateio` logo após o envio | 3 linhas com `valor` 10,00/20,00/40,00 e % 33,3333/66,6667/100 |
| 3 | Load do Alvo (abrir o card ou esperar o cron) | mesmos valores e **mesmos % com 4 casas** no item |
| 4 | `classe_rateio` (cabeçalho) | classes 42,8571/57,1429 somando 100,0000 e R$ 70,00 |
| 5 | Tela de detalhe | valores exatos e % de 4 casas |
| 6 | Limpeza | cancelar o pedido-teste no Alvo |

**Se o Alvo devolver % com 2 casas** (ex.: 14,29): o método continua valendo com 2 casas — trocar as
constantes de precisão no topo de `src/lib/rateioExato.ts` (`CASAS_PERCENTUAL`, `UNIDADES_POR_PONTO`,
`UNIDADES_100_POR_CENTO`) e os testes. Os valores continuam exatos de qualquer forma.

**Conferência (somente leitura):**

```sql
select p.numero, i.sequencia, r.codigo_classe_rec_desp, r.codigo_centro_ctrl,
       r.percentual, r.valor, r.valor_derivado, r.created_at
from compras_pedidos p
join compras_pedidos_itens i on i.pedido_id = p.id
join compras_pedidos_itens_rateio r on r.item_id = i.id
where p.numero = '<NUMERO>' and p.codigo_empresa_filial = '1.01'
order by i.sequencia, r.codigo_classe_rec_desp, r.codigo_centro_ctrl;
```

```sql
select i.sequencia, r.codigo_classe_rec_desp,
       sum(r.percentual) as soma_pct_ccs, sum(r.valor) as soma_valor
from compras_pedidos p
join compras_pedidos_itens i on i.pedido_id = p.id
join compras_pedidos_itens_rateio r on r.item_id = i.id
where p.numero = '<NUMERO>' and p.codigo_empresa_filial = '1.01'
group by i.sequencia, r.codigo_classe_rec_desp
order by 1, 2;
```

```sql
select numero, valor_total, jsonb_pretty(classe_rateio) as cabecalho_do_alvo
from compras_pedidos
where numero = '<NUMERO>' and codigo_empresa_filial = '1.01';
```

---

## 9. Rollback

`git revert <hash do commit>` → `git push origin main` → Publish no Lovable. Não há nada no banco
para desfazer. Pedidos que já saíram por valor continuam íntegros no Alvo; no Hub, as linhas deles
têm `valor` e seguem legíveis pelo carregador antigo (caminho "espelho").

---

## 10. Decisões em aberto (do Pedro)

| # | Decisão | Padrão neste card |
|---|---|---|
| D1 | A mesma lista precisa ser **dividida entre vários itens** do pedido (ex.: 3 produtos rateados pelos mesmos 19 CCs)? | Não: colagem por item/classe. Se precisar, é um card novo — a divisão em matriz (item × CC) fechando linhas e colunas no centavo é resolvível com a mesma aritmética |
| D2 | **Lembrar apelidos** ("Clínico" = ASSUNTOS CLINICOS) para a próxima colagem? | Não: a escolha vale só para aquela colagem. Lembrar exige tabela nova |
| D3 | Corrigir o **resíduo de centavo do caminho por %** (0004919, pendência §7.24) usando o mesmo maior resto? | Não mexido. É uma linha de decisão: trocar o caminho antigo muda o payload de pedidos que hoje saem "certos para o Alvo" |
| D4 | Mostrar valor gravado e % de 4 casas **também nos 992 itens antigos** que fecham (§3)? | Sim. Alternativa: restringir aos pedidos criados no Hub |

---

## 11. Para registrar após o aceite

`PLANO-PEDIDOS.md`, §8 (diário):

```
| 2026-09-XX | RATEIO-MASSA | Rateio de CC por valor no pedido (colar lista do Excel, valor é a verdade, % de 4 casas pelo maior resto). Pedido-teste <NUMERO>: item e cabeçalho com % de 4 casas preservados pelo Alvo; valores exatos. Pedido sem item por valor: payload idêntico ao anterior (5.000 casos). |
```
