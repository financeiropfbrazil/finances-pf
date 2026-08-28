# ESTADO-REVISAO-SUPRIMENTOS
### Estado vivo da missão · última atualização: 28/08/2026, após a sessão de execução Trilha 1 + Trilha 2 (§15)

> **Leia este arquivo ANTES de qualquer coisa nesta missão.** Ele registra o que foi
> executado, o que foi medido e — principalmente — **onde a documentação está errada**.
> Vários fatos abaixo contradizem o `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` e a
> `MISSAO-SYNC-PEDIDOS.md`; quando houver conflito, **este arquivo e os `AJUSTE-RS-*`
> prevalecem**.
>
> Ordem de leitura para sessão nova: `CLAUDE.md` → **este arquivo** →
> `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` → os `AJUSTE-RS-*` do card em questão.

---

## 1. Cards concluídos

| Card | O que foi feito | Validação |
|---|---|---|
| **F0** | `Produto/SavePartial` fora da whitelist do passthrough; routers MCP auditados (fechados: JWKS + lookup em `profiles`); `cost_centers` sincronizado à mão | — |
| **A1** | Open-load migrado para `GET /ped-comp/:filial/:numero` com JWT Supabase (`80bf323`) | Operadora sem credenciais locais abriu pedidos sem erro |
| **B1** | Detalhe da requisição liberado ao líder do CC, exceto rascunho alheio (`f40029c`) | Guilherme (líder de TI, sem `is_admin`) abriu e **rejeitou** pela tela |
| **B3** | `EXECUTE` revogado de `public`+`anon` nas 5 RPCs; `_req_evento` fechada também para `authenticated` | V1: `anon_pode=false` nas cinco |
| **B4** | Auditoria append-only pela **Seção 3-ALT** (mantém INSERT, revoga UPDATE/DELETE) | V3/V4/V5 conferidos |
| **C1** | `compras_pedidos_anchor` criada; rodadas `S1-t0`, `S1-t1` e **`C3-t0`** (esta com os 7 valores em colunas) | 1.898 → 1.902 pedidos |
| **C2 + B2** | Fila do cron alinhada à contagem (`not.is.true`); `'rejeitada'` em `STATUS_TERMINAIS` | 6+ ciclos, zero erros; drenagem 415 → 57 |
| **C3** | Cron passa a gravar rateio por item + parcelas + completar cabeçalho; RPC transacional `sync_replace_filhos_pedido` | Ver §5 |
| **C3.2** | Percentual de classe única ausente + gate de reprocesso (`105e1fb`) | Ver §5 |
| **R1.1** | Tabelas `compras_requisicoes_rateio_classes` / `_cc` + RPC `req_replace_rateio` (`SECURITY DEFINER`, EXECUTE só para `service_role`). `ItemInput` ganhou `codigo_centro_ctrl` próprio (`37852c3`) | VERIFY de assinatura, ACL e RLS ok; tabelas inicialmente vazias como esperado |
| **R1.2** | Cron passa a espelhar rateio de CC e CC de item das requisições vindas do Alvo (`04aa5bf`, deployado) | Itens no Hub: **330 → 439**; requisições sem itens: **94 → 40** *(medido 24/08/2026 19:17 UTC)* |
| **C3.3** | Normalização de rateio: `null` deixa de virar `0`; tolerância ±0,01 com residual; reconstrução de percentual por valor (`d767457` + RPC substituída) | 0004371, 0004471 e 0004691 destravados, com soma fechando exata *(medido 24/08/2026 19:18 UTC)* |
| **SEC-1** | `suprimentos_requisicoes_para` dividida em wrapper + `_impl`; `anon` revogado das 14 RPCs públicas `*_para` e da `_impl` | `anon_pode=false` nas 15 assinaturas; `authenticated` preservado nas 14 públicas e `_impl` restrita a `service_role` *(medido 24/08/2026 19:19 UTC)* |
| **MOEDA A2** | Colunas `codigo_ind_economico` + `valor_cambio`; leitura de `CodigoIndEconomico`/`ValorCambio` nos **6** pontos de escrita (4 gravam, 2 omitem de propósito) | Ver §11 |
| **MOEDA A3** | Backfill a partir do audit `sync_status` (append-only do B4), **sem uma chamada ao Alvo** | 847 pedidos provados; **0** ainda sem moeda na tabela *(medido 27/08/2026 12:42 UTC)* |
| **MOEDA A4** | Exibição na moeda original (card, lista, KPIs e os 3 e-mails) com helper único R$/US$/€; KPIs com escopo de moeda declarado | `d1d3d02`, `57b4243`, `7181846`, `a9e7979` |
| **MOEDA — anti-wipe** | `docs/TESTE-ANTIWIPE-MOEDA.sql` rodado sobre ciclo válido | **W1=W2=W3=0** sobre 847 provados *(27/08/2026 12:31–12:45 UTC)* — ver §11 |
| **D4 — rateio** *(a parte de **parcelas** segue aberta, §7.26)* | `consolidarRateioDoItem` — o caminho do ITEM passa a consolidar (classe, CC) como o do cabeçalho já fazia; aviso na UI quando colapsa | 11 testes automatizados + **validado em produção pelo pedido 0004797**: 2 linhas locais → **1 linha, 100%, R$ 100** no payload, 1 tentativa, sem `UQ_PK`, sem buraco de numeração. Ver §12 |

**Frente de sync encerrada em 20/08 e reaberta em 24/08** pela missão de orçamento por
centro de custo — ver `PLANO-RATEIO-CC-REQUISICOES.md`. Cards **R1.1, R1.2, C3.3 e SEC-1**
entregues em 24/08. A dispensa do Bloco E histórico de pedidos continua valendo (§6); a
nova frente ativa e o saldo do plano v1.1 estão na §9.

---

## 2. 🔴 Correções de fato — a documentação está errada nestes pontos

1. **O cron de compras se chama `bicephalous`** no `job_type` de `sync_runs`. Job pg_cron:
   `sync-compras-status-cron-hourly`.
2. **Roda DE HORA EM HORA**, 11h–20h UTC em dias úteis (8h–17h BRT), ~10 ciclos/dia. As
   janelas "07h30 / 12h30 / 16h30 BRT" do plano **são de outros jobs**.
3. **`excluido_alvo` NÃO é coluna** — é **valor do enum `status_local`**, gravado por
   `avaliarExclusaoPedido` só com o cross-check completo (lista OK, data na janela,
   número ausente). *(Corrigido: a versão anterior deste arquivo dizia que a marcação não
   existia.)*
4. **`compras_pedidos_auditoria` NÃO registra valores** — só status, aprovação, comprado e
   próximo aprovador.
5. **`sync_runs` não tem coluna `job`** — é `job_type`. E **`detalhes` é um ARRAY na raiz**:
   para varrer erros use `jsonb_array_elements(detalhes)`. O `elegiveis_sem_limit` aparece
   no texto de `observacao`.
6. **`compras_pedidos_itens` usa `valor_total_item`**, não `valor_total`.
7. **A auditoria de REQUISIÇÕES é escrita majoritariamente pelo frontend** (887 de 933) —
   ver `AJUSTE-RS-B4.md`.
8. 🔴 **Todo número de população neste documento envelhece a cada ciclo do cron.**
   O cron roda de hora em hora e move as contagens de fila, rateio, parcelas e passivo.
   **Remedir antes de citar** — e **nunca reconciliar por aritmética**. O exemplo é a
   decomposição dos 464 fora da fila, escrita como `450 + 14` para fechar a conta: a
   medição real é **457 terminais + 4 pelo corte de 180 dias + 3 `excluido_alvo`**, e a
   terceira causa nem aparecia no texto. Número ajustado para fechar soma vira
   investigação perdida na sessão seguinte. Por isso cada medição abaixo leva a data e a
   hora em que foi tirada.
9. **A âncora de valores tem prazo de validade curto.** A `C3-t0` (20/08) acusou 9
   alterações em 24/08 — três benignas (null→0) e **seis por edição legítima no ERP**
   (0004635, 0004685, 0004533, 0004704, 0003766, 0004582). Provado contra o Alvo: o
   0004582 foi de R$ 50.504,85 para R$ 51.799,85 no ERP, e o Hub espelhou certo.
   **A âncora serve para conferir imediatamente após uma intervenção, não como referência
   permanente.** Vigente agora: **`C3.3-t0`**, com 1.924 pedidos
   *(capturada 24/08/2026 18:45 UTC; conferida 24/08/2026 19:18 UTC)*.
10. **Lote de comandos no SQL Editor pode falhar em silêncio.** 14 revokes colados juntos
    não surtiram efeito nenhum, sem mensagem de erro; o primeiro da lista provavelmente
    abortou o bloco. Já havia acontecido no R1.1, com 3 blocos perdidos.
    **Regra: conferir o EFEITO com um VERIFY, nunca confiar no "Success".**
11. **`compras_pedidos_itens_rateio.percentual` tem DUAS semânticas históricas.** No legado
    anterior ao C3 o percentual é achatado; nas linhas novas é o percentual do CC
    **dentro** da classe. Há 10 grupos em 4 pedidos (0004026, 0004060, 0004228, 0004269)
    que somam ≠ 100 por isso *(medido 24/08/2026 19:18 UTC)*.
    **Qualquer relatório de orçamento que some essa coluna hoje mistura as duas.**
12. **`sync_runs.total_erros` NÃO conta as falhas de rateio** — o catch registra em
    `detalhes` mas não incrementa o contador. Ciclos aparecem com "0 erros" tendo falhas
    dentro. Para varrer erros: `jsonb_array_elements(detalhes)`.
13. **"Cabeçalho e itens somam o mesmo total" NÃO é regra universal** — a varredura de
    24/08 encontrou 98 contraexemplos em 996 Loads comparáveis *(medição histórica de
    24/08/2026; o horário original não foi registrado)*. Não é regra para extrapolar.

---

## 3. Âncora — como usar

**Vigente: `C3.3-t0`** (24/08/2026 18:45 UTC, 1.924 pedidos, **com os 7 valores em
colunas**). `C3-t0`, `S1-t0` e `S1-t1` são só registro histórico; as duas `S1` são
hash-only.

**Verificação campo a campo (sucesso = zero linhas):**

```sql
select p.numero, p.valor_total, a.valor_total as anc_total,
       p.valor_ipi, a.valor_ipi as anc_ipi,
       p.valor_outras_despesas, a.valor_outras_despesas as anc_outras, p.updated_at
from public.compras_pedidos p
join public.compras_pedidos_anchor a on a.pedido_id = p.id and a.rodada = 'C3.3-t0'
where p.valor_total is distinct from a.valor_total
   or p.valor_mercadoria is distinct from a.valor_mercadoria
   or p.valor_servico is distinct from a.valor_servico
   or p.valor_frete is distinct from a.valor_frete
   or p.valor_desconto is distinct from a.valor_desconto
   or p.valor_ipi is distinct from a.valor_ipi
   or p.valor_outras_despesas is distinct from a.valor_outras_despesas;
```

⚠️ **Linha não-zero NÃO é corrupção por si só.** `NULL` virando valor legítimo também
conta. Padrão já visto duas vezes: pedido novo/nunca visitado entra com `valor_ipi` e
`valor_outras_despesas` nulos e o Load preenche com zero. **Com a `C3-t0` isso se
diagnostica em segundos** — as colunas mostram qual campo mudou e de quanto. Se o
`valor_total` mudar sem correspondência no Alvo, aí sim é problema.

ℹ️ A âncora vigente e o Hub tinham **1.924 pedidos** na conferência
*(medido 24/08/2026 19:18 UTC)*. Pedido descoberto depois da captura não terá linha na
âncora e, portanto, não será coberto pela verificação — não é falha, é o recorte da rodada.

---

## 4. Estado medido (todas as linhas: **medido 20/08 13:20 UTC**)

- **1.904 pedidos** no Hub *(medido 20/08 13:20 UTC)*.
- **Fila do Job 2: 407 elegíveis**, `PED_BATCH_SIZE = 100`, ordem `synced_at asc`
  *(medido 20/08 13:20 UTC)*.
- **`compras_pedidos_itens_rateio`: 637 linhas** em **296 pedidos**, dos quais **46** com
  `valor_derivado = true`. Estava **vazia** em 19/08 *(medido 20/08 13:20 UTC)*.
- **`compras_pedidos_parcelas`: 708 linhas.** Estava **vazia** em 19/08
  *(medido 20/08 13:20 UTC)*.
- **Terminais sem detalhe: 57**, parados — 56 fora do corte de ~180 dias; 1 é o `0004370`,
  padrão de Load 404 permanente *(medido 20/08 13:20 UTC)*.
- **1.164 pedidos** com `classe_rateio` jsonb cheio e relacional vazio — a geração antiga,
  **invisível ao cron**. É o Bloco E *(medido 20/08 13:20 UTC)*.
- **8 pedidos com `status` NULL** *(medido 20/08 13:20 UTC)*.

---

## 5. C3, C3.2 e C3.3 — o que foi aprendido

### O que a RPC faz
`sync_replace_filhos_pedido(p_pedido_id, p_rateios, p_parcelas)` — `SECURITY DEFINER`,
`search_path=public`, EXECUTE só para `service_role`. Normaliza grupos unitários, reconstrói
o único percentual nulo quando há valores, aceita soma dentro de ±0,01 e grava o residual
na última linha; depois valida 100,0000 exato por (item,classe) e por item. Apaga os filhos
**daquele pedido** e reinsere, na mesma transação. Sem UNIQUE e sem upsert: repetição
(item, classe, CC) é legítima.
Valor: usa o do Alvo quando existe; deriva pelo percentual quando vem null/0, marcando
`valor_derivado = true`, com residual na última linha de cada item.

### Defeito 1 (corrigido no C3.2) — percentual de classe omitido
O Alvo às vezes manda `Percentual: null` **no nível da classe do item**, com os CCs
completos e o cabeçalho preenchido. Caso real: 0004602 (classe 16.17, CCs
33.34/33.33/33.33). A extração virava 0 e a validação reprovava.
Correção: **classe única com percentual null/0 → assumir 100** (aritmeticamente
necessário). Múltiplas classes → não adivinhar; aviso nomeado.
*Medido: os 2 casos multiclasse da base têm uma classe em 100% e outra em 0%, então a soma
fecha e a RPC aceita. Nenhum caso exige inferir divisão.*

### Defeito 2 (corrigido no C3.2) — falha silenciosa que se auto-encobria
Quando a RPC falhava, `completarCamposAusentes` **preenchia os jsonb assim mesmo**. Como o
gate usa os jsonb como proxy do relacional, o pedido passava a parecer completo e **nunca
mais seria reprocessado**, nem após a correção. Foi o que aconteceu com o 0004602.
Correção: `filhosOk` controla o preenchimento dos jsonb, e a falha grava
`detalhes_carregados = false`.

### Validação (20/08, ciclo manual)
`0004602` → 3 linhas, classe 16.17, 33.34/33.33/33.33, valores derivados
17.153,43 + 17.148,29 + 17.148,28 = **51.450,00** = `valor_total`. ✅
`0004640` → 2 linhas, classe 19.02, CC 00008.00001.00006, 100% em cada,
69.353,42 + 45.286,57 = **114.639,99** = `valor_total`, `valor_derivado = false`. ✅
*(o item 1 tem rateio 69.353,42 contra `valor_total_item` 60.307,32 — a diferença é o IPI
de 9.046,10. Validar rateio contra o valor do item **sem** impostos rejeitaria este pedido
indevidamente.)*
Âncora `C3-t0`: 3 pedidos acusados, **todos benignos** (0004707/08/09, descobertos após a
captura, `valor_ipi` e `valor_outras_despesas` de null → 0).

### Truque operacional
`synced_at = null` joga o pedido para o **topo** da fila (ordem `asc`, nulo primeiro).
Combinado com `detalhes_carregados = false`, força o reprocesso imediato de um pedido
específico — usado para validar o 0004602 e o 0004640 sem esperar vários ciclos.
Não toca status nem valores, então a âncora segue protegida.

### C3.3 — a varredura de formas e por que ela existiu

As duas normalizações anteriores nasceram de **um caso cada**. Em 24 horas isso quase
produziu uma correção errada. A varredura fechada em 24/08 sobre 1.211 Loads
*(medição histórica de 24/08/2026; o horário original não foi registrado)* mostrou que os
10 pedidos "presos" não tinham causa comum; o universo auditado já alcançava 1.213 pedidos
às 19:19 UTC do mesmo dia:

- 3 eram problema de percentual (0004371, 0004471, 0004691);
- 4 (0002931, 0002990, 0003047, 0003095) estão fora da janela de 180 dias do Job 2 e
  nunca serão visitados — o jsonb deles está íntegro;
- 2 (0004271, 0004441) estão `excluido_alvo`;
- 1 (0004019) tem audit `not_found` com status `sincronizada` — inconsistência própria.

As quatro famílias, detalhadas em `AJUSTE-RS-C3.3.md`, são: F1 arredondamento; F2
percentual ausente com valor recuperável; F3 sem informação (`0004500`, seis CCs nulos,
que **deve falhar**); e F4 item mutilado com cabeçalho íntegro (`0004098`, `0004495`, que
esperam o fallback de cabeçalho).

🔴 **Contraexemplo que salvou a correção:** 0004052 e 0004053 têm CCs a 0% em rateios que
já somam 100. Zero só vira 100 quando a linha é a **única** do grupo.

🔴 **Falso-negativo:** 12 documentos com item ativo passam sem erro porque nenhuma linha
chega à RPC — 3 com item sem classe e 9 com classe sem CC
*(medido 24/08/2026 19:21 UTC, sobre o último Load de 1.213 pedidos auditados)*. São
marcados como completos e ficam invisíveis.

---

## 6. Bloco E — DECISÃO REGISTRADA: backfill histórico dispensado

> **Decisão do Pedro, 20/08/2026.** O backfill histórico está **DISPENSADO**. O foco é
> para frente. O C3 garante que **pedido novo entra completo**; o passivo abaixo
> **permanece sem rateio no relacional, e isso é aceito** — não é pendência, não é dívida
> a cobrar, não é trabalho pendurado. Nenhum card do Bloco E (E1/E2/E3) será executado.

*(toda a medição desta seção: **medido 20/08 13:20 UTC**)*

**O que fica como está.** **492 pedidos** com filhos ausentes; destes o cron ainda alcança
**28** pela drenagem normal, e **464 estão fora da fila**, decompostos assim:

| Causa de bloqueio | Pedidos |
|---|---:|
| Terminal (`Encerrado`/`Cancelado`/`Cancelado Parcial`) com `detalhes_carregados = true` | **457** |
| Fora do corte de ~180 dias | **4** |
| `status_local = 'excluido_alvo'` | **3** |
| **Total fora da fila** | **464** |

> ⚠️ A versão anterior deste documento decompunha os 464 como `450 + 14`, número ajustado
> para fechar a soma. Não era medição. A decomposição acima foi medida; a terceira causa
> não constava. Ver §2 item 8.

Somam-se a eles os **1.164 pedidos** com `classe_rateio` jsonb cheio e relacional vazio —
a geração antiga, invisível ao cron. **Também ficam como estão.**

**Por que a decisão é defensável — o C3 estancou o fluxo.** Na medição do dia anterior o
universo era de **717** pedidos com filhos ausentes, dos quais **253** alcançáveis pelo
cron. Em poucas horas caiu para **492 / 28**: o C3 drenou **~225 pedidos vivos** sozinho,
sem intervenção. Ou seja, o que entra novo entra completo, e o que sobra é exclusivamente
passivo histórico — quase todo terminal com a flag já ligada, documento que não muda mais.

### 🔴 Consequência prática — leia antes de usar qualquer relatório por CC

**Relatórios de gasto por centro de custo só são confiáveis a partir de 20/08/2026.**
O **primeiro semestre de 2026 aparecerá vazio ou incompleto** em qualquer visão que leia
`compras_pedidos_itens_rateio`, porque para aqueles pedidos a tabela nunca foi populada e
não será. Quem montar relatório, dashboard ou fechamento a partir dessa base precisa
declarar o corte — um total histórico "baixo" ali **não é queda de gasto, é ausência de
dado**. Vale também o alerta do `AJUSTE-RS-C3` (C3-E): `compras_pedidos.centro_custo`
**não** substitui o rateio, é a primeira fatia do primeiro rateio.

### Se um dia a comparação histórica for necessária

A porta continua aberta e é barata — por isso a descrição fica registrada:

- **Trilha 1 — jsonb → relacional (a que interessa).** Os **1.164** pedidos da geração
  antiga têm `classe_rateio` e `itens` cheios no jsonb, já no formato de dois níveis que a
  tabela relacional precisa. **Zero chamadas ao Alvo**, migração SQL pura, roda em minutos,
  sem risco de rate limit. Cobre a maior parte do passivo.
- **Trilha 2 — Load → tudo.** Só a geração nova com jsonb vazio; exige chamada ao gateway,
  em lotes de ~25 com pausa. É a cara, e é a menor.

Referência do desenho: `AJUSTE-RS-C3.1-C`. **Nada disso está agendado.**

---

## 6-A. Requisições — estado e contrato do Alvo

**Provado em teste controlado (24/08):** o Alvo aceita rateio de CC em requisição na
estrutura de dois níveis `ReqCompClasseRecDespChildList[]` (classe, `Percentual`) →
`RateioReqCompChildList[]` (`CodigoClasseRecDesp`, `CodigoCentroCtrl`, `Percentual`), sem
campo de valor. Valida 100% por nível (erro 412 `BrokenRulesException`). O
`CodigoCentroCtrl` do item pode divergir do cabeçalho e é preservado. Casos controlados:
**0001445** (classe 11.05, 60/40) e **0001446** (item divergente).

**O que já existia e NÃO é rateio de CC:**
`compras_requisicoes_itens_classe_rec_desp` divide o item por classe contábil, sem CC. A
UI já chama isso de "rateio" — ⚠️ conflito de vocabulário a resolver antes do wizard
(R3.3).

**Estado atual:** 356 requisições, 439 itens e 40 requisições sem itens; nenhuma das 40
ainda está elegível ao Job 1. As tabelas novas têm 2 requisições, 2 classes e 4 CCs —
somente os testes 0001445/0001446, ambos com `origem='alvo'`; continuam existindo **zero
exemplos nativos de produção com rateio**. Entre as 316 requisições com itens, 313 mantêm
o CC do item igual ao cabeçalho e 3 divergem: 0000775, 0001157 e 0001446
*(toda esta medição: 24/08/2026 19:17 UTC)*.

**Cobertura de líderes:** 81 CCs folha ativos, 14 com líder (17,3%), 3 líderes distintos,
concentração 12/1/1. Dos 32 CCs que movimentaram requisição nos 90 dias anteriores à
medição, apenas 3 têm líder *(medido 24/08/2026 19:18 UTC)*. A implantação organizacional
ainda não começou.

---

## 7. Pendências registradas

1. **RPC transacional derruba parcelas junto com rateio.** No 0004602, a falha do rateio
   impediu também as 6 parcelas. Talvez valha separar em duas chamadas — uma classe mal
   formada não deveria bloquear as parcelas. Card próprio.
2. **Pedido cronicamente inválido reentra todo ciclo** (agora com `detalhes_carregados =
   false` na falha). Visível pelo mesmo número repetindo em `detalhes`. Remédio: contador
   de tentativas. Mesma família do item 3.
3. ~~**`0004370`**~~ (02/07, R$ 100, Encerrado): único terminal sem detalhe dentro dos 180
   dias; padrão de Load 404 permanente, reentra para sempre. **NÃO SERÁ TRATADA — ver §6.**
   Fica o registro do padrão, útil se ele aparecer em volume.
4. ~~**57 terminais sem detalhe**~~ (56 fora do corte de 180 dias + o `0004370`).
   **NÃO SERÁ TRATADA — ver §6.** Dependia do Bloco E, que foi dispensado.
5. ~~**8 pedidos com `status` NULL**~~ — zerou após a drenagem: **0**
   *(medido 24/08/2026 19:18 UTC)*.
6. **Nome do CC na tela** — detalhe da requisição mostra só o código. Cosmético, Bloco F;
   depende do espelho `cost_centers` atualizado (F3).
7. **`funcionario_alvo_codigo` do Ryan** — banco `0000063` × roster `0000153`.
8. **`IntegradoFinanceiro`** — 0004705 voltou `"Sim"` e 0004706 `"Não"`, pedidos quase
   idênticos, campo não enviado pelo Hub. Entender o critério do Alvo.
9. **`PedCompUserFieldsObject`** — o Alvo devolve preenchido pelo workflow dele; testar se
   preserva campo livre gravado pelo Hub (necessário para a idempotência do card D3).
10. **Job `nfe` parado desde 11/06/2026** — fora do escopo, mas suspeito.
11. **Pedidos de teste 0004705 e 0004706** — cancelar/excluir no Alvo se ainda não foi feito.
12. **jsonb `classe_rateio`**: o cron grava **cabeçalho-primeiro, item como fallback**,
    igual ao open-load — contraria o C3-A na letra, mas mantém um formato único no jsonb
    (duas telas o leem e o open-load também escreve). **A tabela relacional usa o item, que
    é o que o C3-A exige.** Decisão ratificada em 20/08.
13. **Passos 4–6 do `AJUSTE-RS-C3.3`:** fallback de cabeçalho com coluna `origem_rateio`
    (destrava 0004098 e 0004495, só para pedido de item único); estrutura incompleta parar
    de passar em silêncio; contador de tentativas para conter 0004500 e 0004370.
14. **Semântica dupla do `percentual`** (§2 item 11) — bloqueia a visão por CC.
15. **RPC de requisições mais estrita que a de pedidos** — decidir se tolerância e linha
    única do C3.3 valem lá. Reconstrução por valor não se aplica: requisição não tem valor.
16. **As 13 RPCs `*_para` restantes ainda confiam em `p_user_id` do chamador** em vez de
    `auth.uid()`. O acesso anônimo foi fechado, mas usuário autenticado ainda pode passar
    o UUID de outro. Dívida de desenho.
17. **RPC e itens não compartilham transação no R1.2** — se a gravação de itens falhar
    após a RPC, o rateio fica certo e os itens não; o `updated_at` não rotaciona e o ciclo
    seguinte refaz.
18. **Corrida entre open-load e cron** na inserção de itens de requisição — não há UNIQUE
    por `(requisicao_id, sequencia)`.
19. **R1.2 não remove filhos excedentes** — o conjunto de CCs do último Load diverge do
    Hub em 9 de 221 requisições comparáveis *(medido 24/08/2026 19:20 UTC)*.
20. **17 de 2.015 itens com rateio de valor positivo** não fecham nem contra
    `ValorTotal+IPI` nem contra `ValorFinal` *(medido 24/08/2026 19:20 UTC)*.
21. **6 pedidos e 38 requisições sem detalhe utilizável em nenhuma fonte local** — sem
    itens relacionais e sem itens aproveitáveis nos jsonb/audits correspondentes
    *(medido 24/08/2026 19:20 UTC)*.
22. **Hub não declara moeda ao criar pedido** — `pedidosService.ts` manda
    `CodigoIndEconomico: null` (~625 e ~675); pedido nascido no Hub é implicitamente BRL.
    Ver §11.5.
23. **Parcelas sem moeda** — parcela em dólar ainda exibida como real; estender o helper do
    A4 às parcelas. Ver §11.5.
24. **Rateio do ITEM não tem ajuste residual** (o do cabeçalho tem) — com percentuais
    quebrados sobra centavo entre a soma das linhas e o valor da classe. Anterior ao D4 e não
    tocado por ele. Só vale mexer se o Alvo passar a validar a soma no nível do item. Ver §12.
25. ✅ ~~**LIVRO × ESPELHO no rateio do item**~~ — **FECHADA em 27/08/2026 como TRANSITÓRIA.**
    A divergência medida foi **0 pedidos**. O único caso (0004797, 2 linhas locais × 1 no Alvo)
    **desapareceu durante a própria investigação**: o cron reescreveu as duas linhas de 50% em
    uma de 100% às **19:01:08 UTC**, minutos antes da consulta que o procurava.
    🔴 **Caso didático — dado que se reescreve sozinho.** `compras_pedidos_itens_rateio` é
    **espelho**, não livro: a RPC de sync apaga e reinsere a versão consolidada do Alvo.
    **Medir taxa de digitação humana ali é medir um numerador que se apaga.** A fonte durável é
    `compras_pedidos_auditoria.payload_enviado`, que é imutável. Esse erro de fonte já produziu
    uma taxa inventada nesta mesma investigação (ver 29). *Enunciado original abaixo, preservado:*
    ~~o Hub GRAVA cru e ENVIA consolidado.~~
    `compras_pedidos_itens_rateio` recebe o `item.rateio` cru (`pedidosService.ts` ~1655); o
    payload vai consolidado por (classe, CC). Num colapso real a tabela local terá 2 linhas e
    o Alvo 1 — e **a tela lê a tabela local**. O dinheiro é o mesmo e o Alvo recebe certo:
    é divergência de **representação**, não de valor. **Decisão do Pedro em 27/08: registrar,
    NÃO implementar** — só depois de fechar o D4. Quando entrar, decidir qual é o LIVRO:
    gravar consolidado também, ou sinalizar na tela que o Alvo consolidou.
    Report: §39.2 item 9-B e §40.4 item 14-A.
26. ✅ ~~**D4 — parte de PARCELAS**~~ — **FECHADA em 27/08/2026: o defeito NÃO EXISTE.**
    🔴 **A premissa do card D4 original estava errada.** Ele assumia que faltava normalizar a
    última parcela e que "tolerância de R$ 0,01 chega ao Alvo". Medido:
    · O **ajuste residual já existe** — `calcularParcelas` acumula as N−1 primeiras e faz a
      última = total − acumulado. Absorveu sobras reais (a maior: R$ 0,16 no 0004495, 36
      parcelas de R$ 110.000).
    · **Zero divergência em 152 payloads / 296 linhas de parcela**:
      `sum(ParcPagPedCompChildList[].ValorParcela) == ValorTotal`, diferença máxima R$ 0,00.
    · **Nenhuma** das 22 falhas de envio da história menciona parcela — a única recusa por
      "soma ≠ total" é do **rateio**, não das parcelas.
    · Existe **gate exato ao centavo**, entregue em 21/08/2026 pelo commit **`fc80ae5`** — o
      que torna a tolerância de centavo impossível de chegar ao ERP.
    ⚠️ Não confundir com o card **NOVO §14.3** (parcelas congeladas após atualização do
    `valor_total` pelo cron), que é outro defeito, real, e continua aberto.
    *Enunciado original preservado:* ~~O card D4 original era "normalizar parcelas
    **e** rateio no payload". Só o **rateio** foi entregue e validado em 27/08 (§12). A
    normalização de parcelas (última parcela = total − anteriores) segue pendente.~~
27. ✅ ~~**Rótulo do chip de rateio conta LINHAS, não CCs distintos**~~ — **FECHADO em 28/08/2026**
    (`d1c6439`, §15). `rotuloCcsDistintos` conta por `Set` de `codigo_centro_ctrl` e resolve
    singular/plural num lugar só. *Enunciado original preservado:* (cosmético). Na tela do
    wizard o chip diz `11.01 (100%) — 2 CCs` para duas linhas do **mesmo** CC; depois da
    consolidação é 1 CC. Vem de `cls.ccs.length` em `SuprimentosPedidoNovo.tsx` (~1507 e
    ~2235). Não é erro de valor, mas confunde na revisão do wizard — justamente na tela em que
    a pessoa deveria perceber que repetiu o CC. Registrado em 27/08 a partir do 0004797.

28. ~~🔴 CARD PRÓPRIO — `enviarPedidoParaAprovacao` grava sucesso em ação que não aconteceu.~~
    ### ❌ **INVALIDADA em 27/08/2026 — o card estava errado. Ver 28-A abaixo, que o substitui.**

    **O enunciado errado, preservado para registro** *(escrito em 27/08, com "prioridade acima
    da 29")*: "Em 2 de 2 pedidos examinados, o **primeiro** evento `enviado_aprovacao` foi
    gravado com `sucesso=true` e **o estado no Alvo não mudou**; só o segundo envio surtiu
    efeito. · 0004495 — evento 23/07 14:07; Alvo ainda `Não/Não` em 24/07 17:00. · 0004725 —
    evento 21/08 18:57; Alvo ainda `Não/Não` em 24/08 16:13."

    🔴 **O que o derrubou — medido sobre os 111 eventos, série completa:**

    | Classe | Eventos | % |
    |---|---|---|
    | EFETIVO na 1ª leitura | **106** | 95,5% |
    | EFETIVO TARDIO (virou `Sim` em 22–44h, **sem reenvio**) | 3 | 2,7% |
    | INDETERMINADO | 2 | 1,8% |
    | **SEM_EFEITO comprovado** | **0** | **0%** |

    Os dois pedidos que originaram o card **funcionaram no primeiro envio**: a primeira leitura
    do ERP após o evento de 0004495 é **23/07 18:00:45 (+3h53)** e diz `Sim/Sim`,
    `StatusAprovacao='Em Andamento'`, `prox=HUGO.MAFFEI`.

    **Grupo de controle normalizado por pedido-hora** (o teste que faltava): eventos COM
    comando do Hub produzem transição a **63,8/1000h**; sem comando do Hub, **6,5/1000h** —
    **razão 9,9×**. Sob a hipótese nula as 1.661h do grupo do Hub dariam ~11 transições;
    deram 106. **O envio pelo Hub funciona.** E as 87 reversões `Sim→Não` do histórico:
    **zero** tiveram evento do Hub.

    🔴 **CAUSA DO ERRO, registrada de propósito:** a leitura citada (`24/07 17:00`) **não era a
    primeira posterior ao evento** — era uma reversão ocorrida **23 horas depois** da
    confirmação de que o envio pegou. Foi **leitura seletiva de duas amostras contra a série
    completa**, exatamente a armadilha que o próprio documento já registrava. Os dados
    completos estavam à vista quando o card foi escrito. **O registro do erro vale mais que a
    ausência dele.**

28-A. **CARD PRÓPRIO — o Hub é incapaz de saber se o ERP agiu** *(substitui a 28;
    **prioridade ABAIXO da 29**)*. O defeito real não é "grava sucesso falso", é observabilidade:
    · `pedidosService.ts:2696` — `|| "Sim"` grava `"Sim"` quando o ERP devolve nulo.
      **Gatilho comprovado:** em **138 de 138** respostas de gravação (`envio_sucesso`) o Alvo
      devolve `UserEnviouAprovacao = null`.
    · `:2711-2717` — audit com `sucesso: true` incondicional, sem verificar efeito.
    · Nenhuma verificação de pós-condição; **0 de 111** eventos gravam `resposta_alvo` ou
      `payload_enviado`.
    ⇒ Se o ERP fizesse um no-op silencioso, **o registro do Hub seria idêntico**. O defeito é
    **infalsificável com os dados atuais — o que não é o mesmo que inofensivo.**
    **Dano medido: R$ 120** (0004228 R$ 20 e 0004231 R$ 100, ambos de 16/06/2026, o dia de
    estreia da funcionalidade, ambos indeterminados e **já autocorrigidos pelo cron**).
    ✅ **ESCOPO MÍNIMO APROVADO (Pedro, 27/08): OBSERVABILIDADE PRIMEIRO** — gravar
    `resposta_alvo` e `payload_enviado` no insert do evento `enviado_aprovacao` (`:2711`).
    ⛔ **NÃO tocar no `|| "Sim"` enquanto não soubermos o que o `/ped-comp/update` devolve.**
    Mexer antes é adivinhação: nunca gravamos essa resposta.

28-B. 🔴 **CARD PRÓPRIO — 26 reversões `Sim→Não` sem causa identificada.** Das 87 reversões do
    histórico, **61 são `Aberto→Reavaliar`** (o ERP reseta o flag na devolução — comportamento
    conhecido, **não confundir**). As outras **26 são `Aberto→Aberto`** e não têm explicação.
    Os dois pedidos que originaram a 28 estão entre elas — o card errou a causa, mas tropeçou
    num fenômeno real.
    **Escopo estreito, começa MEDINDO se há padrão:** mesmos aprovadores? mesma faixa de valor?
    mesmo horário? correlação com ciclos do cron? Só depois investigar causa. Aberto em 27/08.

    ### ✅ ENUNCIADO INVERTIDO — registro oficial (Pedro, 28/08/2026)

    > **As 26 `Aberto→Aberto` NÃO são um fenômeno separado das 61/63 `Aberto→Reavaliar`.
    > São o MESMO evento: o ERP zera o bloco de aprovação inteiro** — `StatusAprovacao`
    > 'Em Andamento'→'Nenhum', `UserProximoAprovador`→null, `UserEnviarAprovacao`→'Não' —,
    > e o que distingue os dois grupos é apenas se a mudança de `Status` foi **observada**
    > entre duas leituras. O título original deste card ("26 reversões sem causa
    > identificada") está **superado**: a causa é conhecida e é a mesma das outras.

    🔬 **MEDIDO em 28/08/2026 — `docs/TRILHA2-DIAGNOSTICO-2026-08-28.md` §2. Nada implementado.**
    🔴 **As 26 NÃO são um fenômeno à parte: são o MESMO evento das 63.** Em **22 das 26**, a
    **mesma leitura** que registra o flag `Sim→Não` registra o **bloco inteiro de aprovação sendo
    zerado** — `StatusAprovacao` 'Em Andamento'→'Nenhum', `UserProximoAprovador`→null,
    `UserEnviarAprovacao`→'Não'. Não é um flag caindo sozinho: é o **workflow do ERP resetando**,
    **sem mudança de status _observada_**. Contraste: 22/44 = 50,0% no grupo contra 4/1.932 = 0,21%
    nas outras 9 transições; normalizado por pedido-hora, **590×**. E **63/63** das
    `Aberto→Reavaliar` terminam em `StatusAprovacao='Nenhum'` — mesma assinatura.
    Série remedida: **89** reversões (63 + 26), destinos possíveis **exatamente 2**.
    **Reproduzido ao vivo durante a medição:** 0004786 e 0004785 reverteram às 11:00:36 UTC com
    assinatura idêntica.
    🔴 **Segundo achado — o flag é TRANSIENTE, não livro-razão.** `UserEnviouAprovacao` é na prática
    cópia do comando `UserEnviarAprovacao` (concordam em **4.311/4.313 = 99,95%**), e **24 de 24**
    das que tiveram leitura posterior voltaram a "Sim" sozinhas (22/24 sem nenhuma ação do Hub).
    **0 de 89** tiveram evento do Hub dentro da janela da reversão — o card 28 continua refutado.
    ⚠️ **Consequência VIVA — mas o número do relatório estava INFLADO. Remedido em 28/08/2026
    17:19 UTC, com o denominador certo:**

    | Recorte | Pedidos | Valor |
    |---|---:|---:|
    | `Aberto` + flag "Não" + `Nenhum` (o número que o relatório citou como 21) | **25** | R$ 685.119,43 |
    | └ destes, **nunca leram "Sim"** — nunca foram enviados, não é o fenômeno | **15** | — |
    | └ destes, **leram "Sim" e reverteram** — é o fenômeno | **10** | R$ 26.163,55 |
    | &nbsp;&nbsp;&nbsp;└ reverteram há **menos de 7 dias** (dentro da janela de retorno) | 7 | — |
    | &nbsp;&nbsp;&nbsp;└ **TRAVADOS de verdade** (reverteram há mais de 7 dias e não voltaram) | **3** | **R$ 1.170,00** |

    🔴 **A consequência viva são 3 pedidos e R$ 1.170,00 — não 21 e R$ 685 mil.** Os travados são
    **0004464** (R$ 1.000, desde 21/07), **0004465** (R$ 20, desde 21/07) e **0004467** (R$ 150,
    desde 24/07). O relatório misturou duas populações num filtro só: "está em Não" inclui **todo
    pedido que ninguém nunca mandou aprovar**, que é o estado normal de 15 deles. E o corte de 7
    dias importa porque **24 de 24** das que tiveram leitura posterior voltaram sozinhas, com
    mediana de 18h — os 7 recentes provavelmente voltam antes de alguém notar.

    ⚠️ Mesmo assim a conclusão de produto **não muda**: a fila de aprovação da UI não pode depender
    só desse campo, porque durante a janela o pedido some da fila. O que muda é o **tamanho**, e
    portanto a urgência: é card de produto, não incidente.

    ℹ️ Erro de método registrado: **"está no estado X" não é o mesmo que "chegou ao estado X pelo
    caminho que investigo"**. O filtro precisava do histórico, não só do estado atual.
    ⚠️ **Objeção que anda junto (única que pegou, parcialmente):** o grupo `Aberto→Aberto` pode ser
    o grupo `Aberto→Reavaliar` visto com gap maior — `Reavaliar` é efêmero (70 de 83 somem na
    leitura seguinte) e as 26 têm gaps maiores (mediana 25h × 18h). **Quantificada:** a taxa base
    de entrada em Reavaliar prevê **0,37** ocorrências nas 1.476 pedido-hora das 26; explicar a
    maioria exigiria fator ~50×. E 17 dos 23 pedidos nunca mostram `Reavaliar` na série inteira.
    **Mesmo se fosse verdade, tornaria os dois grupos o mesmo evento — que é a tese.**
    Hipóteses **refutadas** (não reconstruir): aprovadores específicos (o zero de FLAVIO.DIAS é
    artefato de exposição — seus 376 pares nunca tiveram cadeia ativa), horário/dia da semana,
    concentração em ciclo do cron, e o Hub como gatilho.
    🔴 **Bomba armada, achado colateral:** `sameStr` (`index.ts:2237-2241`) **não normaliza acento**.
    Hoje só chega "Não" com til (4.145 "Sim" / 182 "Não" / 445 NULL, zero variantes). Se o Alvo
    passar a devolver "Nao" sem til, **cada ciclo gravaria uma mudança fantasma**.

    ⚠️ **Dois limites estruturais que valem para qualquer medição futura aqui:**
    (i) `sync_status` é **log de mudança, não amostragem** — o cron só grava quando `mudou=true`;
    mediana de ~18h entre leituras. Um ciclo `Sim → reset` inteiro cabe na janela sem rastro.
    (ii) O ramo `jaEnviou` (`:2658-2684`) sai antes **sem gravar auditoria** — **111 é piso de
    tentativas, não teto.**

29. ✅ ~~**Rateio do módulo PROJETOS repete a forma pré-D4**~~ — **FECHADO em 28/08/2026**
    (`8635ae0`, §15), com escopo estreito: colapsa só (classe, CC), mantém a saída PLANA e a
    convenção de `Percentual` deste módulo, para não mexer no payload de criação recém-validado
    pelo A/B 0004798 × 0004799. *Enunciado original preservado:* (pendência, não agora).
    `alvoProjetoPedidoService.ts:151-172` (item) e `:204-221` (cabeçalho) fazem `rateio.map()`
    1:1, sem agrupar (classe, CC) — exatamente o que derrubou o 0004781 com
    `Friendly_Message_UQ_PK`. Hoje **latente**: zero duplicatas medidas em
    `projeto_requisicoes.classe_rateio` *(27/08/2026)*.
    ✅ **O reuso é barato: `consolidarRateioDoItem` já é `export` e é função pura** — basta
    `import` + chamada, **não precisa tocar em `pedidosService.ts`** e não é refactor. Os 11
    testes do D4 cobrem a função e continuam valendo. Próximo card.
30. 🔴 **Pedido de Projetos é indistinguível de pedido nativo do ERP na lista do Suprimentos**
    (pendência, avaliar em card próprio — não implementar agora). Eles chegam a
    `compras_pedidos` pelo Job 3 com `criado_no_hub = false` e **`nome_entidade` vazio**
    (medido em 0004798 e 0004799), sem nenhuma marca de origem. **Foi exatamente isso que me
    obrigou a achar os 8 afetados por fingerprint do campo `texto`** — e o `texto` é editável
    dentro do ERP, o que tornou a contagem um piso em vez de um total (§13.3), e tornou o
    0004626 irrecuperável.
    ✅ **Candidato natural: `NumeroCtrlProjeto` do PedComp** — o campo existe no Alvo e vem
    `null` hoje. Seria a marcação de origem no próprio ERP, imune a edição de texto e
    independente da descoberta do Job 3.
    ⚠️ **Avaliar antes de adotar:** (a) o campo é preservado pelo Alvo? É a mesma dúvida da
    pendência §7.9 sobre campo livre (`PedCompUserFieldsObject`), que já custou o card D3 —
    **não presumir, testar**; (b) escrever nele muda o payload de criação do Projetos, que
    acabou de ser validado — exige novo A/B; (c) decidir se `compras_pedidos` ganha coluna
    espelhada, senão a marca fica só no ERP e a lista continua cega.
    Efeito colateral já medido: os 8 pedidos entram nos KPIs de Suprimentos sem filtro de
    origem (R$ 157.119,80 de R$ 19.998.185,98).


---

## 8. Regras que se mostraram valiosas

- **"Rodar Agora"** na tela de Cron Requisições é seguro e acelera validação (7 ciclos em
  ~10 minutos, zero erros).
- **Antes de concluir corrupção, provar contra o Alvo.** O susto dos 116 pedidos virou
  alarme falso com um Load e um teste de soma dos componentes.
- **Âncora com valores em colunas > âncora com hash.** O hash diz *que* mudou; as colunas
  dizem *o quê*. Diferença entre 10 segundos e uma investigação inteira.
- **Aplicar o SQL na ordem certa:** colunas antes da RPC. O Postgres cria função plpgsql
  que referencia coluna inexistente **sem reclamar** — o erro só aparece na primeira
  execução, em massa.
- **O terminal do Windows trunca saída larga.** Peça SQL em arquivo, ou um comando por
  bloco sem molduras.
- **A Seção de rollback de qualquer SQL não deve ser executada** — é só para guardar.
- **Número sem data não vale.** Ver §2 item 8: as contagens deste módulo mudam a cada
  ciclo do cron; citar sem remedir induz a decisão errada de dimensionamento.
- **Conferir o efeito, não o "Success".** SQL Editor e lotes podem falhar sem produzir a
  mudança esperada; o VERIFY é parte da aplicação.
- **Varredura de formas antes de normalizar.** Caso isolado gera regra errada; sempre
  procurar o contraexemplo antes de transformar ausência, zero ou arredondamento.

---

## 9. Frente ativa de orçamento por CC e saldo do plano v1.1

`PLANO-RATEIO-CC-REQUISICOES.md` é a frente ativa. As decisões R1–R10 estão na §0 daquele
plano e **não devem ser reabertas**. Próximos blocos:

- **R1.3** — backfill das 40 requisições ainda sem itens, todas fora da fila normal
  *(população medida 24/08/2026 19:17 UTC)*.
- **R2** — visão por CC; entrega valor imediato para orçamento.
- **R3** — criação com rateio no Hub.
- **R4** — aprovação múltipla por líderes distintos.

Catálogo do que **nunca foi executado**, para não obrigar ninguém a reler o plano inteiro.
Nada deste catálogo legado está agendado; isso não encerra a frente nova acima.

**Bloco D — endurecimento da criação** (o envio Hub → Alvo, que o C3 não tocou):
- **D1** — invariantes no `enviarPedido` e erros que gritam em vez de falhar em silêncio.
- **D2** — anexos na retomada (pedido reenviado perde os arquivos já anexados).
- **D3** — idempotência do envio: uuid do Hub em campo livre de `PedCompUserFieldsObject` +
  reconciliação antes de qualquer retry. **Depende da pendência §7.9** — falta provar que o
  Alvo preserva o campo livre.
- **D4** — normalização de parcelas e rateio no payload de envio (residual também no rateio
  interno do item; só se manifesta com múltiplos itens).
- **D5** — limite de 255 caracteres na digitação.

**Bloco F — dívidas** (F0 já foi feito, ver §1):
- **F1** — escrita direta em Notas de Serviço (`MovEstq/SaveMultiPart` a partir do
  navegador) → migrar para rota no proxy. Era o **P0 da migração**.
- **F2** — ApiTester admin-only via passthrough.
- **F3** — `cost_centers`: fase 1 passthrough (`CentroCusto/GetRegistros` já está na
  whitelist), fase 2 Edge + cron + `sync_runs` + alerta de idade. É pré-requisito do
  item §7.6 (nome do CC na tela).
- **F4** — migração por etapas dos demais consumidores diretos do Alvo: NF Entrada →
  Contas a Pagar → Sales.
- **F5** — descomissionar credenciais do `localStorage`: remover campos de senha e
  `alvoService.ts`, limpar chaves locais e **rotacionar a senha do ERP**. Só depois que o
  inventário zerar — inclui download de anexos, que ainda não tem rota.
- **F6** — higiene: aposentar as 5 Edges fósseis, remover `SYNC_TEST.md`, KPIs no bloco
  "No gate" (recriando a RPC a partir do `pg_get_functiondef`, nunca da especificação).

**Bloco E** — dispensado por decisão, ver §6. Não retomar sem reler aquela seção.

**A2** (validação com a operação) não tem card próprio em aberto: a validação prevista
— operadora sem credenciais locais abrindo pedidos — foi cumprida e está registrada na
linha do **A1**, §1.

---

## 10. Documentos criados em 24/08

`PLANO-RATEIO-CC-REQUISICOES.md` (plano da missão, com as 10 regras de negócio) ·
`PROMPTS-DISCOVERY-RATEIO-REQ.md` · `PROMPTS-VARREDURA-RATEIO.md` ·
`AJUSTE-RS-C3.3.md` (as 7 regras de normalização, com evidência e contraexemplo) ·
`SQL-R1.1-RATEIO-REQUISICOES.md`.

---

## 11. MOEDA-PEDIDOS (26–27/08/2026) — o que o report não tinha

Detalhe completo no `Requisicoes_e_Compras.md` §27.3 a §27.6. Aqui fica o que **corrige** o
que estava escrito e o que vale como regra geral.

### 11.1 Correções de fato (a documentação estava errada)

1. 🔴 **São 6 pontos de escrita, não 3.** A §27.3 original listava **3, todos no frontend**.
   Faltavam **os 3 do cron** — o caminho que roda ~10×/dia e reescreve pedido já detalhado.
   Corrigir só o frontend teria deixado o cron apagando a moeda de hora em hora.
   **4 gravam:** Load individual, Load em lote, Job 2 (gate `moedaMudou`) e
   `completarCamposAusentes`. **2 omitem de propósito:** `mapPedido` e Job 1 (descoberta) —
   ambos vêm do LIST leve. Outros 3 pontos são neutros (anexos, flags de filhos, ramo `!mudou`).
2. 🔴 **A chave tem que ficar AUSENTE, não valer `null`.** Nos 2 pontos list-based, incluir
   `codigo_ind_economico: null` apagaria o que o Load gravou. Omitir ≠ zerar. É a §20.1 de novo.
3. 🔴 **O LIST leve não traz moeda — medido.** Das **606** auditorias `descoberto_alvo`,
   **zero** têm `CodigoIndEconomico`/`ValorCambio`; das **3.879** `sync_status` (Load),
   **3.879** têm a chave e **2.525** têm valor *(27/08/2026 12:40 UTC)*.
4. 🔴 **São 49 pedidos em moeda estrangeira, não 2.** O sintoma foi levantado com 2 cobaias
   (QOSINA). A população: **39 USD + 10 EUR** *(27/08/2026 12:35 UTC)*.
5. 🔴 **EUR existe em produção** — 10 pedidos em `0000003`. O de-para previa o código, mas
   ninguém tinha confirmado uso real. Um `else → R$` teria exibido dez pedidos em euro como
   reais. O helper precisa dos **três** símbolos.
6. 🔴 **Não existe PDF de pedido de compra neste repo.** A versão anterior da §27.4 listava
   PDF entre os pontos a corrigir. O único gerador é `danfseGeneratorService.ts` (DANFS-e de
   nota de serviço), que não toca `compras_pedidos`. O PDF do pedido, se existe, é do próprio
   Alvo e está fora do alcance do Hub. **Corrigido na §27.4 do report.**

### 11.2 O bucket sem-moeda é presumido BRL — e o precedente é do ERP

Dos 1.121 pedidos sem moeda, **78 têm `valor_cambio` preenchido, todos exatamente `1`**. E há
**310** auditorias em que o Alvo devolveu `CodigoIndEconomico` como **JSON `null`** com
`ValorCambio: "1"` *(27/08/2026 12:38 UTC)*. **"Sem moeda + câmbio 1" é o dialeto do Alvo para
real** — não é dado faltando: o ERP não omite, ele afirma câmbio 1.

Dá **lastro documental ao bucket presumido dos KPIs** (deixa de ser convenção do Hub). **Não
muda a decisão INDICADOR** — o indicador segue `codigo_ind_economico`, e `valor_cambio`
continua referência de registro, fora do cálculo do símbolo. ⚠️ E não vale invertido: câmbio 1
sozinho não prova BRL (pedido estrangeiro com câmbio mal preenchido também teria 1) — o que
sustenta é o **par** moeda-null + câmbio 1.

- ⚠️ **CLEVERBRIDGE GMBH (0004743)** — fornecedor alemão, nome que puxa para o euro, **segue
  DENTRO do bucket sem-moeda**, presumido BRL com o precedente acima. **Não é exceção nem
  exclusão.** Registrado porque é o caso que convida ao chute.

### 11.3 Regras novas que valem além desta missão

- **O audit é fonte de backfill — antes de pedir dado ao ERP, ver se a auditoria já o tem.**
  `compras_pedidos_auditoria` é append-only desde o **B4**, e `sync_status` guarda a resposta
  do Load inteira. Deu **847 pedidos com moeda provada e zero chamadas novas ao Alvo**; o
  backfill do A3 saiu daí e **já drenou 100%**. O B4 pagou uma dívida que ninguém tinha
  cobrado ainda.
- 🔴 **Ciclo que não rodou não prova nada — todo teste sobre o cron precisa de gate.** Em
  **27/08 01:41 UTC** uma invocação `manual_admin` fora da janela registrou **150 consultados,
  `total_mudaram` = 0, `total_erros` = 152** (Alvo devolvendo 404 HTML na autenticação) — e a
  linha entrou em `sync_runs` normalmente. **O Alvo tem janela noturna; invocação manual fora
  de 11h–20h UTC devolve lixo.** Por isso o Bloco 6 do teste anti-wipe roda **antes** do
  Bloco 1: exige `total_erros` baixo **E** `total_mudaram > 0` antes de acreditar em `W = 0`.
  Mesma família da armadilha "flag de completude que mente" (§39.2 item 9 do report).
- 🔴 **Não editar em lote arquivo com não-ASCII.** Em 26/08, no A4, um `perl -0pi -e` nos três
  `notify-pedido-*` transformou **todo `—` em `â`** — inclusive dentro de `return "—"` — e
  **só pegou 1 dos 3 arquivos**. Teria ido para e-mail de produção lido por quem aprova
  pedido. Arquivo com `—`, `€`, `US$`, `ç`, `ã` **se edita ponto a ponto**. Detalhe e regra de
  conferência em `Requisicoes_e_Compras.md` §39.1 item 5.

### 11.4 O veredito do anti-wipe (27/08/2026 12:31–12:45 UTC)

| Sinal | Resultado |
|---|---|
| Pedidos com moeda provada no audit | **847** (840 em 26/08 — subiu) |
| **W1** moeda perdida · **W2** divergente · **W3** câmbio perdido | **0 · 0 · 0** |
| Ciclos válidos do dia (`pg_cron` 11:00 e 12:00 UTC) | 515/516 consultados, **49 e 46 mudaram**, **0 erros** |
| Provados reescritos hoje (`synced_at` ≥ 11:00) | **118** — nenhum perdeu moeda ou câmbio |
| Destes, com `updated_at` avançado (mudança real) | **19** — também sobreviveram |

O teste pegou o dia de maior reescrita da semana (26/08 mudava 2 a 12 por ciclo). Cobaias
0004564/0004568 tocados às 11:00 e 12:00, seguem `0000002` com câmbio 5.1211 e 5.0733.
**Card fechado.**

### 11.5 Residuais registrados (não bloqueiam o fechamento)

1. **O Hub não declara moeda ao criar pedido.** As 134 auditorias `envio_sucesso` têm as
   chaves `CodigoIndEconomico`/`ValorCambio` mas **nenhuma com valor** — `pedidosService.ts`
   manda `CodigoIndEconomico: null` (~625 e ~675). Pedido nascido no Hub é sempre
   implicitamente BRL. Não é regressão (sempre foi assim), mas o ciclo fecha pela metade: o
   Hub lê moeda do Alvo e não escreve. Card próprio quando houver pedido estrangeiro criado
   no Hub.
2. **Parcelas sem moeda** — herda a lacuna; parcela em dólar ainda exibida como real. Estender
   o helper às parcelas (report §29.10 item 1).

---

## 12. D4 — rateio duplicado (`Friendly_Message_UQ_PK`), 27/08/2026

Evidência do episódio: `docs/D4-EVIDENCIA-UQ-PK.md`. Plano e medições:
`docs/D4-PLANO-CORRECAO.md`.

**A causa era uma assimetria dentro do próprio `pedidosService.ts`.** Dois caminhos consomem o
mesmo `input.itens[].rateio`: o do **cabeçalho** (`rateioAgregado`, ~1030) usa
`Map<classe, Map<CC,…>>` e **já consolidava desde sempre**; o do **item** (~951) eram dois
`map` 1:1, **sem agrupar nada**. Mesmo input → cabeçalho com 1 linha a 100%, item com 2 linhas
de 50%. O Alvo tem UNIQUE em (filial, número, produto, sequência, classe, CC) e recusava.

**A correção portou o padrão do cabeçalho para o item** (`consolidarRateioDoItem`), somando os
`Valor` já calculados. Aviso na UI (`SuprimentosPedidoNovo.tsx`, `handleSalvarItem`) quando há
colapso — **a consolidação acontece independentemente do aviso**.

### Achados que mudaram o escopo

1. 🔴 **Prevalência real: 1 pedido em 134** (~0,75%) — só o 0004781, com 6 envios falhos.
   O valor do card está no **custo quando acontece** (6 números queimados no sequencer +
   31 min), não na frequência.
2. 🔴 **`Sequencia: 0` NÃO colide — não mexer nela.** Uma varredura pela tupla que o Alvo
   declara no erro acusa 4 pedidos, mas 0004598, 0004617 e 0004719 **passaram de primeira, em
   ~8s**. Neles a repetição é entre **itens distintos** com mesmo produto. Que tenham passado
   prova que **o Alvo atribui a sequência real no save**. Uma "correção" que numerasse a
   sequência no envio mexeria em 134 pedidos de caminho feliz para resolver 1.
3. **A origem não é a requisição.** 0004781 veio da requisição 0001274, mas
   `compras_requisicoes_rateio_classes`/`_cc` têm 2 classes e 4 linhas no total, **zero
   duplicatas** *(27/08/2026 12:52 UTC)*. Nasceu no wizard — provavelmente "adicionar CC" duas
   vezes + `dividirCcsIgualmente`, que com 2 linhas gera exatamente o 50/50 do caso.
4. **O caminho do item não tem ajuste residual — e isso é anterior ao D4.** Com percentuais
   quebrados (33,33/33,33/33,34 de R$ 1.199,98) as linhas somam R$ 1.199,97 contra R$ 1.199,98
   da classe. O comportamento é idêntico antes e depois da consolidação; quem tem ajuste
   residual é o caminho do **cabeçalho**, que é onde o Alvo valida a soma. **Não foi tocado**
   (fora do escopo aprovado). Ver pendência §7.24.

### ✅ Validação do colapso — pedido 0004797 (27/08/2026 15:11 UTC)

O caso de teste real: 1 item (BOVINE PERICARDIUM LEAFLET IVC 31, 1 UNID × R$ 100,00), **uma**
classe `11.01`, o **mesmo CC** `00010.00002.00007.00002` **duas vezes**, 50/50. O toast de
consolidação apareceu na tela antes do envio, com a mensagem correta — que é o que separa este
pedido dos dois controles.

| # | Conferência | Esperado | Medido |
|---|---|---|---|
| 1 | `compras_pedidos_itens_rateio` (cru) | 2 linhas, 50/50 | ✅ 2 linhas, mesmo CC, 50% + 50% |
| 2 | `payload_enviado` → item | 1 linha, 100%, R$ 100 | ✅ **1 linha, 100%, R$ 100,00** |
| 3 | `payload_enviado` → cabeçalho | 1 linha, 100% | ✅ 1 linha, 100%, R$ 100,00 |
| 4 | Tentativas de envio | 1, sem `Friendly_Message_UQ_PK` | ✅ 1 `envio_tentado` → `envio_sucesso` em 5s, zero `envio_falha` |
| 5 | Numeração | sem buraco | ✅ 0004793→0004797; o 0004796 é do cron (`criado_no_hub=false`) |
| 6 | Load do Alvo | 1 linha | ⏳ pendente — pedido criado 15:11, ciclo anterior 15:00; chega às 16:00 UTC |

🔴 **A divergência 2 × 1 entre a tabela local e o payload É a prova de que o colapso agiu** —
e aqui ela é esperada e correta (é a pendência §7.25 em ação). Onde o Hub guardou 50 + 50, o
Alvo recebeu uma linha a 100%. É a forma exata que queimou 6 números do sequencer no 0004781;
desta vez o ERP aceitou de primeira.

**Card D4-rateio FECHADO.** ⚠️ A parte de **PARCELAS** do D4 original (normalizar parcelas no
payload) **continua aberta** — ver §7.26. O D4 nunca foi só rateio.

### Validação anterior — os dois controles (27/08/2026)

Dois pedidos criados no Alvo para validar: **0004794** (dois CCs distintos) e **0004795**
(pretendia repetir o mesmo CC). Medido pelo MCP às 14:20 UTC:

| | 0004794 | 0004795 |
|---|---|---|
| Rateio | classe 13.07, 2 CCs, 50/50 | classe 13.04, **3 CCs distintos**, 33,33/33,33/33,34 |
| CC repetido | não | **não** |
| Tentativas de envio | 1, sucesso | 1, sucesso |
| `Friendly_Message_UQ_PK` | não | não |
| Load do Alvo | chegou (2 CCs a R$ 50) | ainda não (`detalhes_carregados=false`) |

🔴 **O 0004795 NÃO reproduziu o defeito** — saiu com três CCs diferentes, não com o mesmo
repetido. Confirmado nas três fontes (tabela local, `ItemPedCompChildList` do payload e
cabeçalho), e de forma definitiva: a persistência local grava o rateio **cru**, então 3 linhas
distintas = 3 CCs digitados. Se houvesse colapso, o payload traria uma linha com percentual
somado (66,66); trouxe 33,33/33,33/33,34.

**Portanto os dois valeram como CONTROLE, não como prova do colapso.** O que ficou provado: o
caminho feliz não regrediu em produção contra o ERP real, em duas formas (percentual redondo e
quebrado), com numeração 0004786→0004795 **sem buracos** — nenhum número queimado. A prova do
colapso depende do pedido C (1 item, 1 classe, mesmo CC duas vezes, 50/50), com o toast de
consolidação confirmado na tela **antes** do envio: sem toast, não é o caso de teste.

### Garantia de não-regressão

Quando não há o que consolidar — **133 dos 134 pedidos históricos** — a função devolve as
linhas idênticas às de antes: peso 1 e sem re-arredondamento, verificado por teste. `tsc`
limpo, `bun run build` limpo, lint **110 erros = exatamente a baseline do HEAD** (zero novos).
`src/test/sidebar-ordem.test.tsx` falha 7/7 **também no HEAD** — pré-existente, não é do D4.

---

## 13. PROJETOS — pedido nascia enviado para aprovação (27/08/2026)

> ✅ **RESOLVIDO E VALIDADO EM PRODUÇÃO — 27/08/2026 17:42 UTC.** O aviso operacional que
> vivia aqui ("não enviar pelo módulo Projetos") **está encerrado**: o fix foi publicado e
> comprovado pelo par 0004798 × 0004799 (§13.5). Os 21 rascunhos voltaram a ser seguros.
> *(Histórico: entre a descoberta e o Publish, cada envio reproduzia o defeito.)*

### 13.1 🚨 INCIDENTE DE CONTROLE INTERNO — pedido 0004664

**R$ 110.000,00 completaram a cadeia de aprovação do ERP em 26/08/2026 sem nenhum comando
humano de autorização no Hub.**

| | |
|---|---|
| Pedido | **0004664** — "Congresso Rio Valves | Req #24" |
| Valor | **R$ 110.000,00** |
| Criado | 13/08/2026 14:34 UTC, por **ana.sanches@pfbrazil.com** |
| Aprovado no Alvo | **26/08/2026 12:25 UTC** — `aprovado='Total'`, `status_aprovacao='Finalizada'` |
| Aprovador designado | FLAVIO.DIAS |
| Comando de envio no Hub | **NENHUM** — não existe evento de autorização |
| Estado hoje | Cancelado |

🔴 **Isto é achado de controle interno, não nota técnica.** A cadeia de aprovação existe
para registrar que alguém *decidiu* mandar o pedido adiante. Aqui a decisão nunca foi
tomada por uma pessoa: o payload de criação já continha a ordem. **Uma aprovação sem evento
de autorização não é uma aprovação — é um registro que parece uma.** Um sistema de aprovação
externo (Riosoft) construído sobre esse sinal recebeu, deste pedido, um consentimento que
ninguém deu.

**Encaminhamento (não é correção de dado — o Hub não tem como "desenviar"):** comunicar
FLAVIO.DIAS e ana.sanches@pfbrazil.com que a aprovação chegou sem comando humano, para
confirmar se a aprovação em si foi consciente. **Decisão de controladoria, não de código.**

### 13.2 A causa (medido)

`src/services/alvoProjetoPedidoService.ts` mandava, **hardcoded no INSERT**:

```js
PedCompUserFieldsObject: { UserEnviarAprovacao: "Sim", UserEnviouAprovacao: "Sim" }
```

`UserEnviarAprovacao: "Sim"` é o **comando** que dispara a cadeia — é exatamente o que
`enviarPedidoParaAprovacao` escreve no passo manual do Suprimentos (`pedidosService.ts:2689`
+ `POST /ped-comp/update`). O Suprimentos manda `PedCompUserFieldsObject: {}` na criação
(`pedidosService.ts:1256`) e reserva o comando para o botão.

🔴 **LIVRO × ESPELHO pela quarta vez:** `UserEnviarAprovacao` é o **comando** (o Hub
escreve); `UserEnviouAprovacao` é o **fato** (o ERP deriva, o Hub só lê em 9 pontos). O
único escritor do campo-fato em todo o repositório era a linha removida. Projetos não só
dava a ordem — carimbava o espelho com o fato consumado.

**Não é regressão de 07/08.** `git blame` põe o bloco no commit inicial `61246ec`
(30/03/2026), nunca tocado. 07/08 mudou a **visibilidade** (open-load L7-A passou a espelhar
`enviou_aprovacao`), não o comportamento.

**Correção:** `65fa83e` — 1 arquivo, exclusivo do Projetos. `pedidosService.ts` intocado.

### 13.3 Universo afetado — **8 conhecidos**, e por que não digo "exatamente oito"

Três fontes cruzadas *(medido 27/08/2026 17:0x UTC)*:

| Fonte | Capturou | Comentário |
|---|---|---|
| `compras_pedidos.texto` (fingerprint `Projeto: … \| Req #`) | **8 de 8** | única fonte completa |
| `projeto_requisicoes.numero_pedido_alvo` (livro do módulo) | **2 de 8** | só grava desde o L1; os 6 antigos são anteriores |
| `projeto_eventos` (`pedido_enviado_alvo`) | **1 de 8** | tabela criada em 07/08 |

🔴 **O cruzamento NÃO fechou a contagem — mas mostrou outra coisa: as duas fontes ditas
"melhores" são subconjuntos estritos do fingerprint.** Nenhuma delas achou um pedido que o
fingerprint tivesse perdido. Isso é evidência a favor de 8, não prova.

**Por que não afirmo "exatamente oito":** o fingerprint depende do campo `texto`, editável
dentro do ERP. Procurei uma assinatura imune e **não existe**: `codigo_usuario` não
discrimina (PEDRO.SCRIGNOLI aparece em 27 pedidos fora do grupo) e `compras_pedidos` não
espelha `CodigoComprador` (que seria a assinatura boa — Projetos manda `0000013` fixo,
Suprimentos manda `null`). **A janela residual é estreita e nomeável: pedido criado pelo
Projetos ANTES de 07/08/2026 cujo `texto` tenha sido editado no ERP.** Foi exatamente isso
que tornou o **0004626** (citado em `PLANO-PROJETOS.md:727`) irrecuperável — ele não existe
em nenhuma tabela hoje.

Para registro de incidente: **8 pedidos identificados, R$ 157.119,80**, com a ressalva acima
declarada em vez de escondida.

| Pedido | Valor | Data | Estado | `enviou_aprovacao` |
|---|---|---|---|---|
| **0004664** | **R$ 110.000** | 13/08 | Cancelado — **aprovado='Total'/Finalizada** | Sim |
| 0003780 | R$ 18.000 | 14/04 | **Aberto — único vivo e travado** (ALEXANDRE.RIBEIRO) | Sim |
| 0003946 | R$ 10.000 | 11/05 | Cancelado | Sim |
| 0004238 | R$ 1.000 | 18/06 | excluído do Alvo | Sim |
| 0003628/29/38/39 | R$ 38.019,80 | 25–26/03 | Encerrados | NULL — nunca capturado, **ambíguo** |

### 13.4 🔴 A evidência é de CÓDIGO, não de observação — e isso importa

O diagnóstico rodou com 12 agentes. **Três conclusões deles não sobreviveram à conferência**,
e ficam registradas para ninguém reconstruí-las:

1. **"Eco de payload" é falso.** A síntese afirmou que o `resposta_alvo` do evento
   `descoberto_alvo` é eco do que o Hub mandou. **607 de 607 desses eventos têm
   `payload_enviado` NULL** — é estado lido do ERP, não eco.
2. **O "experimento natural" (0004495/0004725) é leitura seletiva.** A série completa mostra
   o campo **oscilando**: `Sim → Não → Sim → Não → Sim`. O "Não" usado como estado virgem era
   **reversão** (provável `Reavaliar`, que reseta o flag no ERP).
3. **A observação não discrimina.** Entre pedidos do **Suprimentos** que nunca tiveram evento
   `enviado_aprovacao`, **14 leem `Sim/Sim` no ERP** (contra 5 em `Não`). Marcar à mão dentro
   do Alvo é prática corrente — logo "pedidos de Projetos aparecem enviados" **não prova** a
   causa sozinho.

**O que sustenta o diagnóstico é o código:** o Hub literalmente escrevia o campo-comando no
insert. Isso é fato sobre o que o Hub manda, não inferência sobre o que o ERP faz.

**H3 (chamada encadeada): refutada** — um único `fetch(` no arquivo, zero referências a
`/ped-comp/update` no módulo. **H2 (a rota `SavePartial?action=Insert` dispara sozinha):
enfraquecida, não eliminada** — `/ped-comp/insert` e `/ped-comp/update` batem no **mesmo
endpoint do Alvo**, diferindo só no `action`, e no `/update` o disparo é comandado pelo
campo. Mas **nenhum caso natural separa rota de payload**, então H2 não está provada inerte.
**O teste de aceite desempata de graça.**

### 13.5 ✅ FECHAMENTO — o par 0004798 × 0004799 (27/08/2026)

**Card fechado com um A/B controlado em produção**, e não apenas com um teste de aceite.
Dois pedidos do mesmo módulo, mesmo operador, mesmo projeto, mesmo valor, **9 minutos de
intervalo**, lidos pelo **mesmo ciclo do cron com 0,2 segundo de diferença**
(`descoberto_alvo` às 17:42:11.118 e 17:42:11.338 UTC). A única variável que mudou entre os
dois foi o código publicado.

Objeto devolvido pelo **próprio ERP** (`resposta_alvo->'PedCompUserFieldsObject'`):

| | **0004798** — 17:29:47 UTC · **pré-fix** | **0004799** — 17:38:40 UTC · **pós-fix** |
|---|---|---|
| `UserEnviarAprovacao` | **"Sim"** | **"Nao"** |
| `UserEnviouAprovacao` | **"Sim"** | **null** |
| `UserProximoAprovador` | FLAVIO.DIAS | FLAVIO.DIAS |
| Badge na lista do Suprimentos | **"Enviado para aprovação"** | **"Aguardando envio p/ aprovação"** |

Antes e depois lado a lado na mesma tela.

🔴 **Isto REFUTA a H2 — não a enfraquece.** Os dois pedidos usaram a **mesma rota**
(`/ped-comp/insert` → `PedComp/SavePartial?action=Insert`). Payload diferente ⇒ resultado
diferente. **O endpoint está provado inerte.** O resíduo que a entrega declarou
honestamente — "afirmo que a rota não é *necessária*, não que seja inofensiva" — **está
fechado por evidência**. Era o único caso natural que separava rota de payload, e ele não
existia até este teste criá-lo.

⚠️ **`UserProximoAprovador = "FLAVIO.DIAS"` aparece nos DOIS.** Confirma, na prática, o
alerta de §13.5 anterior: se o critério de aceite fosse `proximo_aprovador`, teria dado
falso negativo. **O marcador válido é `UserEnviarAprovacao` / `UserEnviouAprovacao`.**
Registre-se também a grafia do default do ERP: `"Nao"` **sem til** — diferente do `"Não"`
que aparece em outras leituras. Não comparar por string exata sem normalizar.

### 13.5-A Procedimento do teste de aceite (mantido para reuso)

Criar 1 pedido pelo módulo Projetos, esperar o Job 3, e ler o objeto do **ERP**:

```sql
select cp.numero, a.created_at, a.resposta_alvo->'PedCompUserFieldsObject' as ufo
from public.compras_pedidos_auditoria a
join public.compras_pedidos cp on cp.id = a.pedido_id
where a.evento in ('descoberto_alvo','sync_status') and cp.numero = '<novo>'
order by a.created_at limit 1;
```

**Esperado:** `UserEnviarAprovacao='Não'`, `UserEnviouAprovacao='Não'`, `UserProximoAprovador=null`.
**Se voltar `Sim` com payload vazio: H2 ressuscita** e a correção passa a ser de rota — card novo.

- ✅ **Pré-requisito conferido:** os 3 projetos (`Congresso Caipira Rio Preto`, `teste`,
  `Congresso Rio Valves`) estão em `fase_atual='actual'` + `status='aprovado'`, e
  `ana.sanches` tem `alvo_usuario='ANA.SANCHES'`. Os gates de
  `alvoProjetoPedidoService.ts:334-335` e `:350-356` **não vão matar o teste**.
- ⚠️ **Não usar `proximo_aprovador` nem `status_aprovacao` como critério** — o Alvo preenche
  `proximo_aprovador` na criação inclusive nos pedidos corretos. E `enviou_aprovacao = NULL`
  no Hub significa "não capturado", não "não enviado". O marcador válido é o objeto do ERP.

### 13.6 Consequência operacional — a decisão é sua

Depois do fix o pedido de projeto fica em "Aguardando envio p/ aprovação" e **o módulo
Projetos não tem botão de envio** (zero referências a `/ped-comp/update` no módulo; a única
"aprovação" daquela tela é a de **budget**, sentido 1, outro assunto).

🔴 **A saída "usar a tela do Suprimentos" NÃO funciona para quem usa o módulo.** Medido:
`ana.sanches@pfbrazil.com` tem `is_admin = false` e **zero linhas em `user_permissions`** —
não tem `compras.pedidos.access`, que é o gate da rota `/suprimentos/pedidos/:id`
(`App.tsx:314`). Ela **não alcança** `SuprimentosPedidoDetalhe`. A opção (a) está fora sem
uma mudança de permissão.

---

## 14. Cards abertos em 27/08/2026 pela varredura de pendências

> Tudo abaixo é **diagnóstico**. Nenhuma implementação foi feita. Ordem de execução aprovada
> pelo Pedro no fim desta seção (§14.9).

### 14.1 ✅ CARD 1 — `compras_pedidos.tipo` grava o eixo errado — **FECHADO em 27/08/2026**

> **Corrigido (`ab0e0f3`) e backfill aplicado pelo Pedro.** Evidência de fechamento em §14.1-F.

A coluna deveria carregar a **natureza** da compra (Produto / Serviço / Misto). O cron grava o
**tipo de entrega** do Alvo (`Total`). São **dois eixos diferentes na mesma coluna** — a família
LIVRO × ESPELHO de novo.

| Mês | Pedidos | Filtráveis por natureza |
|---|---|---|
| 2026-04 | 214 | 47 |
| 2026-05 | 187 | 99 |
| **2026-06** | **233** | **0** |
| **2026-07** | **214** | **0** |
| **2026-08** | **214** | **0** |

**916 pedidos gravados como `Total`, R$ 9.570.393,60** *(medido 27/08/2026)*. Nos três últimos
meses o filtro de natureza retorna **zero de 661**. Não é degradação — é falha total, e **todo
pedido novo entra assim** (o cron tem janela rolante de 30 dias).

- Domínio real do campo no Alvo: **`Total` (4.746) e `Programado` (2)**. `Parcial` não existe.
- O efeito na tela é **por mês**, não "916 escondidos numa lista": `ComprasPedidosCompra.tsx:141-145`
  carrega um mês por vez.
- ✅ **TETO DE GRAVIDADE — nenhum cálculo financeiro lê a coluna.** Só filtro, badge e export
  Excel. **É defeito de relatório, não de dinheiro.**

#### Caminho demonstrado — dois escritores, duas semânticas, uma coluna

| Escritor | Código | Grava | Eixo |
|---|---|---|---|
| **Cron — Job 1 (descoberta)** | `sync-compras-status-cron/index.ts:1290` → `tipo: ped.Tipo` | `"Total"` | **entrega** |
| **Frontend** | `alvoPedCompService.ts:257-262` (deriva de `ValorServico`/`ValorMercadoria`) | `"Produto"` / `"Serviço"` / `"Misto"` | **natureza** |

**MEDIDO — o Alvo nunca devolve natureza:** `resposta_alvo->>'Tipo'` tem **`Total` em 4.746
leituras** e `Programado` em 2. Produto/Serviço/Misto: **zero**. O cron não está "copiando
errado" — está copiando um campo que **nunca teve** a informação que a coluna promete.

**Corte temporal, medido:**

| tipo | `criado_no_hub` | pedidos | mais recente |
|---|---|---|---|
| `Produto` | false | 624 | **21/05/2026** |
| `Serviço` | false | 428 | 20/05/2026 |
| `Misto` | false | 9 | 20/05/2026 |
| **`Total`** | false | **782** | 27/08/2026 |
| **`Total`** | **true** | **134** | 27/08/2026 |

O frontend deixou de escrever em **21/05**; o Job 1 assumiu e não saiu mais. ⚠️ **Até os 134
pedidos criados no Hub estão como `Total`** — a descoberta os alcança e sobrescreve.
Só o **Job 1** grava a coluna (o Job 2 não a inclui no upsert).

#### Teto de gravidade — VERIFICADO

Leitores da coluna em todo o repo: **exatamente 3, todos em `ComprasPedidosCompra.tsx`** —
filtro (`:207`), export Excel (`:223`) e badge (`:580`). **Nenhum cálculo financeiro, nenhuma
RPC, nenhum KPI.** Confirma: **defeito de relatório, não de dinheiro.**

**Plano mínimo:** o `mapPedido` do frontend já tem a derivação pronta e correta
(`alvoPedCompService.ts:257-262`) — o Job 1 precisa aplicar a mesma regra em `:1290` em vez de
copiar `ped.Tipo`. Os campos de que ela depende (`ValorMercadoria`, `ValorServico`) **já vêm no
list** e já são gravados nas linhas vizinhas. **Custo: uma expressão, um ponto.**
⚠️ **Não extrair helper compartilhado agora** — o frontend e o cron são deployados por caminhos
diferentes (Lovable × Edge Function); duplicar a regra com comentário cruzado é mais seguro
neste momento do que criar acoplamento entre os dois.

**Depende do Pedro:** o **backfill dos 916** é decisão à parte — mexe em 46% da tabela e é
reversível só com recarga do Alvo. O fix do cron sozinho **não corrige o passado**: pedidos já
gravados como `Total` só mudam se forem revisitados e o Job 2 não escreve essa coluna.

### 14.1-F ✅ Fechamento do CARD 1 — evidência

**Correção** (`ab0e0f3`), 3 pontos, regra duplicada de propósito com comentário cruzado:
`sync-compras-status-cron/index.ts` (nova `derivarNaturezaPedido` + call site `:1290`) ·
`alvoPedCompService.ts` (mesma função no `mapPedido`) · `ComprasPedidosCompra.tsx` (fallback do
`tipoBadge` de `"Misto"` para `"—"` — sem isso, `null` continuaria exibindo "Misto").
**Backfill** por `docs/BACKFILL-TIPO-NATUREZA.sql`, derivação local, zero chamadas ao gateway.

#### VERIFY funcional por mês — o filtro voltou, e além do previsto

| Mês | Total | Filtráveis por natureza | Sem valor |
|---|---|---|---|
| 2026-04 | 214 | **213** | 1 |
| 2026-05 | 187 | **186** | 1 |
| **2026-06** | 233 | **231** *(era 0)* | 2 |
| **2026-07** | 214 | **210** *(era 0)* | 4 |
| **2026-08** | 215 | **211** *(era 0)* | 4 |

🔴 **O alcance foi maior que o diagnóstico previa.** Abril e maio **também** estavam
degradados — 167 e 88 pedidos como `Total` — e não apareceram na medição original porque ela
olhou só a queda a zero de jun/jul/ago. A transição não foi um corte limpo em 21/05: foi
**gradual desde abril**, com o Job 1 e o frontend disputando a coluna.

#### VERIFY estrutural *(lido por mim no MCP, 27/08)*

`divergentes = 0` · `ainda_como_Total = 0` · base 1.978 pedidos.
Distribuição: **Produto 1.230 · Serviço 728 · Misto 1 · NULL 19**.

#### 🔴 Os dois casos individuais — contagem agregada não prova regra

**O Misto GENUÍNO: `0004016`** (MILCA JOSE DOS REIS, 22/05) — `valor_mercadoria` R$ 2.433,20 +
`valor_servico` R$ 2.160,00 = R$ 4.593,20. Estava como **`Total`**, virou **`Misto`**. E o Alvo
**continua devolvendo `"Tipo": "Total"`** — é a prova direta de que a coluna parou de espelhar o
eixo de entrega e passou a carregar a natureza. É o análogo do 0004564 no card de moeda.

**Os falsos Misto → NULL:** `0003210`, `0003399`, `0003409`, `0003968` conferidos
nominalmente — todos `null`, todos com ambos os valores zerados. **`0003210` tem 4 itens**, o
que confirma que a leitura certa é "sem valor lançado", não "misto". Os outros 5 seguem por
construção: havia 9 `Misto`, todos falsos; hoje há 1 (o genuíno, que antes era `Total`); e
`divergentes = 0` força o restante a NULL.

**Lição registrada:** a regra antiga varria ambos-zero para `Misto`. O defeito de fundo
(eixo errado) escondia um segundo defeito (categoria poluída) que só apareceu ao medir para
decidir a convenção — não ao ler o código.

### 14.2 ✅ CARD 2 — 6 requisições rebaixadas sem auditoria · **RESOLVIDO em 28/08/2026 — era o Job 4**

Seis requisições passaram de `convertida_pedido` para `sincronizada` **sem uma única linha de
auditoria**.

🔴 **É a única classe de achado que contamina todas as outras.** Enquanto houver escrita não
rastreada em `compras_requisicoes`, **nenhuma medição de status de requisição é confiável —
inclusive as desta própria varredura** (o §14.4, por exemplo, sai da mesma tabela). Por isso foi
o **1º da ordem de execução**.

#### As 6 (medido 27/08/2026)

| Requisição | Convertida em | Pedido vinculado | Auditorias após a conversão |
|---|---|---|---|
| 0001187 | 11/06 20:52 | null | **0** |
| 0001240 | 16/06 18:12 | null | **0** |
| 0001259 | 23/06 15:00 | null | **0** |
| **0001215** | 03/07 19:00 | **0004382** | **0** |
| 0001343 | 24/07 15:28 | null | **0** |
| 0001397 | 19/08 12:00 | null | **0** |

Todas têm evento `convertida_pedido` auditado e hoje estão em `sincronizada`. Confere pelo
agregado: **238 eventos `convertida_pedido` contra 234 requisições nesse status.**

#### 🔴 Investigação — a conclusão errada, e o que a derrubou

**Registrado na ordem em que aconteceu, porque o percurso vale mais que o resultado.**

**1. Conclusão errada.** Medi que as 6 tinham `updated_at` de **hoje**, dentro dos ciclos do
cron das 18:00 e 19:00 UTC, e concluí que o rebaixamento estava acontecendo naquele momento.
Montei a cadeia inteira: o mapper `mapReqAlvoToHub` (`index.ts:436`) tem um **fallback** que
devolve `sincronizada`; o upsert de `:1060` grava o status; o insert de auditoria de `:1094` usa
`evento: 'sync_status'`, que **não está no CHECK**
(`compras_requisicoes_auditoria_evento_check`, 15 valores, sem esse); e o insert **não checa
`error`** — o supabase-js retorna `{data, error}` em vez de lançar. Status gravado, auditoria
rejeitada, erro descartado. Cadeia coerente, e errada.

**2. O que a derrubou.** `index.ts:1045` — quando o status **não** muda, o cron faz
`update({ updated_at: now() })` **só para rotacionar a fila** (comentário no código: *"sem isto,
as 50 candidatas mais antigas monopolizam o lote"*). As 6 estão em `sincronizada`, o mapper
devolve `sincronizada`, então elas são **rotacionadas toda hora**. Eu li um carimbo de rotação
como carimbo de mudança.

**3. 🔴 Consequência permanente — regra para medições futuras:**
> **`compras_requisicoes.updated_at` NÃO É EVIDÊNCIA TEMPORAL.** É reescrito a cada ciclo em
> toda candidata cujo status não mudou. **A data do rebaixamento das 6 é desconhecida e não é
> recuperável por esse campo.** Nenhuma medição futura deve usá-lo para datar nada.

#### Escritores eliminados — por código, um a um

| Escritor | Motivo da eliminação |
|---|---|
| ~~**Cron (job de requisições)**~~ | ❌ **ELIMINAÇÃO ERRADA — corrigida em 28/08/2026. Era ele.** *Texto original preservado:* ~~A fila é `.eq("status", "sincronizada")` (`index.ts:970`) — **nunca seleciona** uma requisição em `convertida_pedido`. E `git log -S` mostra o filtro nascendo junto com o arquivo em **`f6d795e` (24/05/2026)**, anterior a **todas** as 6 conversões (11/06 a 19/08). **Nunca houve janela.** Eliminado **por código, não por horário.**~~ 🔴 O argumento é verdadeiro **sobre o Job 1** e falso sobre o componente: o **Job 4** (`syncDescobrirRequisicoes`) **não trabalha por fila** — varre o *list* do Alvo e alcança qualquer requisição, em qualquer status. A frase "o cron nunca seleciona" generalizou um job para o cron inteiro. |
| **RPCs (9 que escrevem na tabela)** | **Nenhuma seta `status`.** Consulta por `update … compras_requisicoes` + `status =` retorna **zero**. |
| **`desvincular_pedido_requisicao`** | Dois motivos independentes: **não toca `status`** (só limpa `numero_pedido_compra_alvo`) e **audita sempre** (`desvinculado_pedido`). As 6 têm `tem_desvinculo = 0`. |
| **Triggers** | Só existem `set_..._updated_at` e `fn_req_protege_aprovacao`; este **apenas lança exceção**, nunca modifica linha. |
| **Frontend** | Só dois pontos setam `sincronizada` — `requisicoesService.ts:629` e `:1003` —, ambos no caminho de envio, e **ambos auditam** (`envio_tentado` antes, `envio_sucesso`/`envio_falha` depois). As 6 têm **zero** auditorias após a conversão. |

~~**Nenhum caminho de código do repositório explica o rebaixamento.**~~ ❌ **FALSO.** Explicava: o Job 4. A conclusão era consequência direta da eliminação errada acima.

#### Suspeitos que sobram — investigação ABERTA, não forçada a conclusão

1. **Escrita direta no SQL Editor** (`service_role`, sem auditoria por construção) — **o mais
   provável**, e consistente com o histórico de correções manuais do projeto.
2. **Outro cliente com `service_role`** — o CLAUDE.md registra um agente Codex no mesmo Supabase.
3. **Caminho de código removido** — sem evidência; `git log -S` só alcança o que se sabe procurar.

⏳ **Pedro vai verificar se rodou `UPDATE` em `compras_requisicoes` entre junho e agosto.** Se
lembrar, a investigação fecha. **Se não, ela permanece aberta com os 3 suspeitos — e é assim que
deve ficar registrada.**

### ✅ 28/08/2026 — A INVESTIGAÇÃO FECHA, E O CULPADO É O PRÓPRIO CÓDIGO

🔴 **Nenhum dos 3 suspeitos. É o Job 4 do cron** (`syncDescobrirRequisicoes`), ramo de reabertura.
A tabela "Escritores eliminados" acima examinou o filtro do **Job 1** (`.eq("status",
"sincronizada")`) e concluiu "o cron nunca seleciona uma requisição em `convertida_pedido`". Isso é
verdade para o Job 1 — e **o Job 4 nunca foi olhado**. Ele não trabalha por fila: varre o *list* do
Alvo.

**A cadeia, lida no código e conferida no banco:**
1. `reaberturaConfirmada` = `GerouPedComp === "Não"` **E** `Status === "Aberto"` (bloco de 22/06/2026)
   **libera** o rebaixamento `convertida_pedido` → `sincronizada`, que a guarda anti-rebaixamento
   normalmente proíbe.
2. O `UPDATE` grava o status **e zera `numero_pedido_compra_alvo`**.
3. O insert de auditoria seguinte monta `evento: "sync_status"` — que **não está no CHECK** — e
   **não conferia o `error`**. Rejeitado em silêncio; `total_mudaram++` na linha seguinte.

⇒ É a assinatura exata das 6: **5 perderam o vínculo** (zerado no passo 2) e a **0001215 o manteve**
porque o Job 2 e o Job 3 **re-vinculam** quando o campo está null. Isso explica também a "anomalia
dentro da anomalia" que ficou registrada como sem explicação.

### 🔴 O IRMÃO — `descoberta_alvo`, e este falha há três meses, não é armadilha adormecida

O insert do ramo de **INSERT** do Job 4 usa `evento: "descoberta_alvo"`, **também fora do CHECK**.

| | |
|---|---|
| Nasceu em | **`0081425`, 26/05/2026** — *"Job 4 substitui UPSERT por SELECT+UPDATE/INSERT seletivo"* |
| Linhas com esse evento na tabela | **0** *(medido 28/08/2026)* |
| Requisições **sem nenhuma** linha de auditoria | **69** |
| Dessas, com `requisitante_user_id` null (= nascidas no Job 4) | **69 de 69** |
| Total já descoberto pelo Job 4 | **125** |

⇒ **Toda requisição nova vinda do Alvo entra no Hub sem linha de origem, e o ciclo conta como
sucesso.** Não é "armadilha adormecida" como o §14.2-A descrevia o caso do Job 1: **está disparando
desde maio**, em 100% das descobertas.

🔴 **O contraste que fecha o diagnóstico:** `compras_pedidos_auditoria` **não tem CHECK nenhum**, e
por isso o `descoberto_alvo` do lado dos **pedidos** tem centenas de linhas gravadas. O defeito é
exclusivo do lado **requisição**, e a causa é a constraint — não o código do insert.

⚠️ **O SQL da defesa (a) não recupera as 69.** A resposta do Alvo daquele momento não existe mais.
Ele só impede a 70ª.

**Corrigido em `3c33735`** (exige deploy da Edge Function) + `docs/SQL-14.2A-check-sync-status.sql`,
que passou a incluir os **dois** eventos. ⚠️ O SQL **não recupera as 69** — a resposta do Alvo
daquele momento não existe mais; ele só impede a 70ª.

⚠️ **A data do rebaixamento das 6 continua desconhecida** e não é recuperável: `updated_at` é
rotação de fila e a linha de auditoria foi justamente a que o CHECK rejeitou. A atribuição ao Job 4
é por **evidência estrutural convergente** — é o único caminho do repositório que zera
`numero_pedido_compra_alvo` junto com uma escrita de status, e o bloco existe desde 22/06/2026,
anterior a todas as 6 conversões —, **não por carimbo temporal**.

### 🔴 LIÇÃO DE MÉTODO — eliminação de componente exige eliminação JOB A JOB

**Este erro já tinha nome e já tinha acontecido.** É o mesmo do §11.1 item 1 (o card MOEDA):
*"São 6 pontos de escrita, não 3. A §27.3 original listava 3, todos no frontend. Faltavam os 3 do
cron."* Lá, o inventário de pontos de escrita parou onde a busca era confortável. Aqui, o
inventário de **escritores suspeitos** parou no primeiro job do componente.

> **REGRA: um componente multi-job não se elimina como um bloco.** `sync-compras-status-cron`
> tem **quatro** jobs, com **estratégias de seleção diferentes** — Job 1 e Job 2 trabalham por
> **fila** (`.eq(status, …)`, corte de 180 dias, `BATCH_SIZE`), Job 3 e Job 4 **varrem o list do
> Alvo** e alcançam qualquer linha, em qualquer status. Um argumento sobre a fila **não fala pelos
> jobs que não usam fila**. Eliminar exige percorrer **cada job** e dizer, de cada um, por que
> não pode ter escrito.

**Como isso se aplica na prática, daqui para frente:**
1. Ao escrever "o componente X não pode ter feito Y", **liste os pontos de entrada de X** antes de
   concluir. Se forem N, o argumento precisa de N linhas, não de uma.
2. `git log -S` só alcança **o que se sabe procurar**. Aqui ele achou o filtro do Job 1 (que
   existia) e confirmou uma janela que era irrelevante, porque o caminho real não passava por
   filtro nenhum.
3. **Uma tabela de "escritores eliminados" com uma linha por componente é uma tabela mal
   dimensionada.** A granularidade certa é o ponto de escrita, não o arquivo nem o processo.

#### 🔴 Destaque: 0001215 é o caso anômalo dentro da anomalia

É a **única das 6 que MANTÉM o pedido vinculado** (`numero_pedido_compra_alvo = 0004382`). As
outras cinco perderam o vínculo. **Se o rebaixamento foi manual, alguém mexeu numa requisição
que estava consistente** — o que enfraquece a hipótese de "correção de dado órfão" e fortalece a
de engano.
**A conferir:** o que o pedido **0004382** diz no Alvo sobre a requisição de origem.

### 14.2-A 🔴 CARD — ARMADILHA ADORMECIDA: `sync_status` fora do CHECK

**Achado colateral da investigação do §14.2, e mais acionável que o culpado dela.**

O cron monta `eventoAudit = "sync_status"` para o ramo `sincronizada` (`index.ts:1092`), mas
**`sync_status` NÃO está no CHECK** `compras_requisicoes_auditoria_evento_check` (15 valores
aceitos, nenhum é esse). O insert seria **rejeitado**.

Hoje é **código morto — por acidente de fluxo, não por desenho**: a fila só traz requisições já
em `sincronizada` (`:970`), o mapper devolve `sincronizada`, então cai no `if (novoStatus ===
req.status)` e o ramo nunca é alcançado. **É por isso que `sync_status` tem zero ocorrências na
tabela.**

🔴 **Se alguém mudar o filtro da fila, ela acorda como escrita sem rastro de verdade** — e com o
agravante de que:
- o insert de `:1094` **não checa `error`**, e o supabase-js **retorna `{data, error}` em vez de
  lançar** ⇒ a rejeição é descartada em silêncio;
- o `result.total_mudaram++` da linha seguinte executa como se tivesse dado certo ⇒ **o
  `sync_runs` reportaria sucesso**.

O status já teria sido gravado em `:1060`, **antes** do insert. Resultado: exatamente o padrão
do §14.2, só que causado pelo próprio código.

**Duas defesas independentes — registrar as duas, implementar depois:**
- **(a) Alinhar CHECK e código** — incluir `sync_status` na constraint **ou** remover o ramo.
  ✅ **SQL ENTREGUE em 28/08/2026:** `docs/SQL-14.2A-check-sync-status.sql` (PREVIEW → APPLY
  idempotente → VERIFY remedindo, com prova funcional em BEGIN/ROLLBACK). **Aguarda o Pedro rodar.**
- **(b) Checar o `error` do insert de auditoria** e **não** contar `total_mudaram++` quando ele
  falhar. Sem (b), qualquer valor futuro fora do CHECK reproduz o problema.
  ✅ **IMPLEMENTADO em 28/08/2026** (`9171141`, §15). ⚠️ **Exige deploy da Edge Function** — não
  entra por push. Marcador anti-deploy-fantasma: `BUILD_TAG = "REQ-AUDITORIA-CHECA-ERRO (2026-08-28)"`.

⚠️ **(a) sozinha não basta:** ela conserta este valor, não a classe. **(b) sozinha não basta:**
o ciclo passaria a acusar erro em vez de mentir, mas o status continuaria gravado sem auditoria.
São complementares.

### 14.3 CARD 3 — parcelas congeladas após o cron atualizar `valor_total`

**Não confundir com o D4-parcelas (§7.26), que foi fechado como inexistente.**

**26 de 363 pedidos (7,2%)** têm as parcelas locais divergindo do `valor_total`,
**R$ 240.747,29** em valor absoluto. Piores: 0004586 (R$ 143.045,42), 0004495 (R$ 55.000,00),
0004674 (R$ 13.500,00).

**Causa medida:** no envio o payload estava **perfeito** (`dif_no_envio = R$ 0,00`); o cron
atualizou o `valor_total` depois e **as parcelas ficaram congeladas**. **Zero casos na faixa
R$ 0,01–R$ 0,10** — não é arredondamento; a menor divergência é R$ 8,50.

### 🔴 PRIORIDADE ELEVADA (Pedro, 28/08/2026): com 902 pedidos, este é o MAIOR PASSIVO ABERTO

O card entrou como "26 pedidos, R$ 240.747,29". A medição do diagnóstico mostrou que os 26 são a
**ponta visível**: o mesmo portão de presença impede que **902 pedidos** — que **têm** parcelas no
último Load do Alvo — recebam qualquer linha em `compras_pedidos_parcelas`. **O passivo é ~35×
maior que o enunciado do card**, e passa à frente do que sobrou da fila.

⚠️ **902 é elegibilidade técnica, não passivo confirmado.** Falta o critério de negócio: quais
tipos/status **devem** ter parcelas espelhadas. Sem ele, o número dimensiona o alcance do portão,
não a dívida. **Medir isso é o passo que decide entre "corrigir o portão" e "backfill em massa".**

🔬 **Desdobrado em 28/08/2026 17:31 UTC** — e o desdobramento muda a conversa:

| Recorte | Pedidos |
|---|---:|
| Sem parcela local, **com** parcelas no último Load do Alvo | **902** |
| └ em status **TERMINAL** (documento que não muda mais) | **665** |
| └ **VIVOS** | **237** |

⇒ **O passivo acionável é da ordem de 237, não 902.** Os 665 terminais são decisão de negócio:
espelhar histórico encerrado tem valor de relatório, não de operação. A pergunta que fecha a
conta: **alguma tela, relatório ou RPC lê `compras_pedidos_parcelas` de pedido terminal?** Se não
lê, os 665 saem.

📋 **Passo de validação preparado, sem tocar em código:**
`docs/SQL-14.3-G-validar-portao-parcelas.sql` — snapshot das **duas** tabelas que a RPC apaga
(parcelas **e** rateio) → `detalhes_carregados = false` + `synced_at = null` nos divergentes →
esperar 1–2 ciclos válidos → remedir. Se convergirem, o portão é a causa; **se não convergirem, a
hipótese cai e nenhum arquivo foi tocado.**
⛔ **0003872 fica de fora**: nele o próprio Alvo está incoerente (R$ 13.900 de `ValorTotal` contra
R$ 17.514 de soma de parcelas no Load). É correção no ERP, não espelhamento.
ℹ️ Números remedidos no mesmo instante: **368** com parcelas locais, **28** divergentes
(R$ 241.024,08), **10** deles terminais — o card entrou com 365/26/R$ 240.747,29 meio dia antes.

🔬 **DIAGNÓSTICO FECHADO em 28/08/2026 — `docs/TRILHA2-DIAGNOSTICO-2026-08-28.md` §1.**
**Nada implementado**, como combinado. A causa é uma **assimetria de sincronização**: `valor_total`
é regravado pelo Job 2 a cada ciclo em que o Alvo muda (`index.ts:2299`), enquanto a única rotina
que reescreve `compras_pedidos_parcelas` (`persistirItensPedido` → `sync_replace_filhos_pedido`)
está atrás de um portão de **PRESENÇA**, não de coerência (`index.ts:2138-2140`;
`filhosAusentes` = jsonb nulo ou vazio, `:1504-1508`). Com `detalhes_carregados = true` em
**365 de 365**, o portão está fechado em 100% do universo. Direção causal provada: nos 13
divergentes que têm Load anterior à escrita das parcelas, **13/13** batiam exatamente na época —
não foi gravação errada, foi o Alvo mover depois.
🔴 **O passivo é ~35× maior que os 26:** 902 pedidos têm parcelas no último Load do Alvo e
**nenhuma** linha local, e o mesmo portão impede que recebam *(medido 28/08/2026 11:17 UTC,
denominador 1.979)*. Remedido por mim às 11:30 UTC: 365 / 26 / R$ 240.747,29 conferem.
🔴 **Achado colateral — escritor SEM RASTRO:** `alvoPedCompLoadService.ts:407-461` (open-load,
roda a **cada abertura** de card) grava `valor_total`, o jsonb `parcelas` e
`detalhes_carregados: true`, **nunca toca a tabela de parcelas** e **não grava auditoria**. É ele
que fecha o portão do cron. Caso associado: 0004756.
▶️ **Próximo passo proposto (não executado):** snapshot de `compras_pedidos_parcelas` **e**
`compras_pedidos_itens_rateio` dos 26 → `detalhes_carregados = false` nos 25 (exceto 0003872, que
é incoerência do próprio ERP) → esperar 1–2 ciclos válidos. Valida o diagnóstico **sem alterar um
arquivo**. ⚠️ 10 dos 26 estão em status terminal e o patch do portão sozinho **não os alcança**.

### 14.4 CARD 4 — identidade da requisição: 230/230 vão ao ERP como PEDRO.SCRIGNOLI

**230 de 230** requisições efetivamente enviadas foram ao Alvo com `CodigoUsuario` literal
`PEDRO.SCRIGNOLI`. Destas, **3 eram da ANA.SANCHES** (0001250, 0001261, 0001270 — jun/2026),
que **tinha identidade própria disponível** e foi descartada.

*(Denominador corrigido na verificação: `numero_alvo is not null` dá 355, mas 125 vieram do
espelho e nunca passaram pelo payload do Hub.)*

🔴 **Mesma família do A-8 do `PLANO-PROJETOS` §12** — identidade emprestada no ERP —, só que no
módulo de **requisições** e por outro campo. Grupo de controle no mesmo repo: o caminho de
**pedido** acerta 120 de 134 (89,6%); o de **requisição**, 0 de 230.

✅ **IMPLEMENTADO em 28/08/2026** (`c6984e1`, §15): regra D-17 — sem `profiles.alvo_usuario` o envio
PARA, com mensagem clara; nunca cai para a identidade de outra pessoa. `USUARIO_LOGADO` deixou de
existir no arquivo. Gate nos dois caminhos que chegam ao ERP, antes do payload e antes de qualquer
escrita. 8 testes com duplo do Supabase e `fetch` espionado.

🔴 **Remedição de 28/08/2026 10:5x UTC — o denominador muda o enunciado em dois pontos:**
- São **226** payloads de `envio_tentado`, não 230; **225** dizem `PEDRO.SCRIGNOLI` e o 226º
  (10/04/2026) é anterior ao campo. **32** pessoas distintas do Hub, **1** único `CodigoUsuario`.
- Ana Sanches: **3** requisições (0001250, 0001261, 0001270), como já constava aqui.
- 🔴 **NORMALIZAÇÃO QUE MUDA A LEITURA:** `CodigoFuncionario` tem **34 códigos DISTINTOS** nos
  mesmos 226 envios. **O ERP sempre soube QUEM pediu** — o que estava emprestado era o login do
  **operador**, não o requisitante. O achado é real, e é menor do que "identidade emprestada" sem
  qualificação.

⛔ **BLOQUEIO DE PUBLISH, MEDIDO:** das 32 pessoas que já enviaram requisição, **apenas 2** têm
`alvo_usuario` (pedro.scrignoli e ana.sanches). As outras **30** respondem por **194 dos 226 envios
(85,8%)**, e **29 das 30** tiveram login nos últimos 90 dias. **Publicar sem preencher os logins
para o módulo de requisições para 30 pessoas.** Lista e SQL em
`docs/SQL-14.4-alvo-usuario-requisicoes.sql`, com a saída alternativa (B) de um login de serviço
único — que **não** contraria a D-17, já que ela proíbe emprestar a identidade de uma **pessoa**.

> ⚠️ **Números corrigidos em 28/08/2026, na verificação adversarial.** A primeira redação dizia
> "197 envios" e "todas ativas". **197 era `226 − 29`** — "todos menos o Pedro" —, e contava os 3
> envios da ana.sanches como se ela não tivesse login, justamente os 3 que este card cita como
> identidade própria descartada: a mesma pessoa nos dois lados da conta. E há **uma** inativa
> (bianca.goncalves, 25 envios, último acesso 08/05/2026). O erro é do tipo que a §2 item 8 já
> registra: número ajustado para fechar narrativa.

🔴 **SEGUNDO DENOMINADOR, que a primeira medição não viu: os LÍDERES.** No fluxo com aprovação
(rota `PENDENTE` → o líder aprova → `reenviarRequisicaoAprovada`), quem envia ao ERP é o **líder**,
e o gate resolve a identidade pela sessão de quem clica. Medido em 28/08/2026: **3 líderes ativos,
2 com login**. O único sem login é **guilherme.oliveira** — que é também o **maior emissor da série
(37 dos 226 envios)**. O CC dele fica sem saída pelos dois eixos. **É o primeiro login a cadastrar.**

🔴 **O que o card NÃO resolve, e vira pendência própria:**
1. **`profiles` está aberta no RLS** — a única policy é `ALL / authenticated / true / true`:
   qualquer um dos 57 usuários pode escrever `alvo_usuario` em **qualquer** perfil. A garantia "o
   Hub não lança documento com a identidade de outra pessoa" é, no limite, **auto-declarada**.
   Pré-existente (Projetos já dependia disso), mas é este card que faz a coluna carregar identidade
   no módulo de maior volume.
2. **O caminho de resgate reintroduz o defeito**: quando o admin reenvia a requisição travada de
   outra pessoa, o gate lê a sessão DELE e o documento entra no ERP como PEDRO.SCRIGNOLI — por um
   botão que a própria correção torna necessário. A tela não mostra em nome de quem o envio sai.
3. **`pedidosService.ts` continua com o fallback.** `USUARIO_LOGADO` e `resolverUsuarioAlvo` seguem
   vivos no envio de **pedido**: quem não tem login emite pedido como PEDRO.SCRIGNOLI, em silêncio.
   **Quarta ocorrência do mesmo padrão**, agora nomeada.
ℹ️ A colisão do **A-10** segue viva e é outro campo: `nfe@` e `pedro.scrignoli@` continuam
compartilhando `funcionario_alvo_codigo = 0000149` *(conferido 28/08/2026)*.

### 14.5 🔴 CARD 5 — caminho ATIVO para o `UQ_PK` no wizard de Projetos

**Separado do §7.29 de propósito:** aquele é latente com exposição zero; **este é ativo**.

Com o rateio já em 100%, **dois cliques em "Adicionar Classe"** criam duas linhas com
`percentual: 0` e classe/CC **vazios** (`ProjetoRequisicoes.tsx:1635` — `100 - totalRateio > 0
? ... : 0`). A soma continua 100, então passa nas **três** validações (UI `:429`, RPC
`projeto_pedido_salvar`, e `validar()` do service — nenhuma checa unicidade), e o payload sai
com **dois nós idênticos** de `CodigoClasseRecDesp: ''` + `CodigoCentroCtrl: ''`.

**Tratar junto com o item do percentual (5º da ordem).**
*Hipótese não testada:* se o Alvo rejeita por classe inválida **antes** de bater no UNIQUE.

✅ **FECHADO em 28/08/2026** (`56be472`, §15). `validarLinhasRateio` **recusa** — não consolida —
linha em branco e par (classe, CC) repetido, nos **dois** portões (UI `handleSave` e `validar()` do
service), com mensagem que nomeia a **linha** e o **problema**. A hipótese acima continua não
testada e agora é **irrelevante para o caminho normal**: a linha em branco nem sai do Hub.

### 14.6 Moeda no envio — decisão registrada (Pedro, 27/08)

**MEDIDO:** 111 de 134 pedidos do Hub (82,8%) sem moeda, **R$ 1.023.389,75**; destes **36
(R$ 641.793,59) são irrecuperáveis** (terminal + `detalhes_carregados=true`, o cron não visita).
Normalizado por exposição: 69,6% dos nativos têm moeda no 1º Load contra 9,1% do Hub — **razão
7,6×**. Dano materializado: **1 pedido** (0004592, €226,50, corrigido à mão em 4h32).

⚠️ **Correção de enunciado:** o payload **OMITE** `CodigoIndEconomico` (não manda null) e manda
**`ValorCambio: 1` hardcoded**.

- ❌ **(a) Parar de mandar `ValorCambio: 1` — CANCELADO em 27/08/2026, depois de aprovado.**

  *Decisão anterior, preservada:* ~~APROVADO. O Hub afirma um câmbio que não sabe; omitir é
  mais honesto e é a mesma regra do card MOEDA-PEDIDOS.~~

  🔴 **A premissa estava CERTA; a medição esvaziou a consequência.** O Hub de fato afirma um
  câmbio que não sabe — mas essa afirmação **não vincula nada**:

  | O que o Alvo guardou, em pedidos criados pelo Hub | Moeda | Pedidos |
  |---|---|---|
  | `ValorCambio = 1` | `(null)` | 108 |
  | `ValorCambio = 1` | `0000001` (BRL) | 21 |
  | **`ValorCambio = 5.8473`** | **`0000003` (EUR)** | **1** |

  **Evidência decisiva — o 0004592:** saiu do Hub com `ValorCambio: 1` e o Alvo hoje guarda
  **5,8473**. **O ERP sobrescreve o câmbio assim que define a moeda.** Nos outros 129, `1` é o
  valor correto de qualquer forma.
  ⇒ **Ganho da mudança: honestidade de payload, sem nenhuma consequência em dado.**

  **Risco, do outro lado:** **152 de 152** pedidos da história mandam o campo — **zero
  omissões**. Não há uma única evidência de que o Alvo aceite a ausência em `PedComp`.
  *(As 226/226 requisições que omitem são `ReqComp`, outra entidade — não transferem. E o
  gateway não valida o campo, então ele não é obstáculo nem juiz.)* Omitir arrisca o **caminho
  de criação**, o mais usado do módulo.

  **E o teste também não será feito** (decisão do Pedro): confirmá-lo exigiria **publicar a
  mudança em produção**, e o desfecho mais provável — "o Alvo aceita e grava `1` sozinho" — não
  mudaria a decisão. **Não se arrisca o caminho de criação para provar que uma mudança é
  inócua.**

  🔴 **Mesmo padrão do card 28: premissa plausível, medição derruba.** Fica como precedente —
  antes de mexer num caminho de escrita em produção, medir se o que se corrige tem consequência.
- ⛔ **(b) Seletor de moeda na UI — NÃO por ora.** Taxa estrangeira de **0,90%** entre os
  sem-moeda e **um** caso materializado não justificam mudar a UI; o Alvo define sozinho em 82%.
  **Reavaliar se a taxa subir.**

*(A extrapolação de "~R$ 200 mil de subestimação de KPI" foi **refutada** na verificação →
faixa real **R$ 4,3 mil a R$ 30,5 mil**.)*

#### Mapa dos 4 sites de `ValorCambio` — para não refazer a busca

| Site | Função | Valor | Escopo |
|---|---|---|---|
| `pedidosService.ts:610` | `enriquecerItemViaAlvo` | `1` | **Consulta**, não criação — busca impostos/classificação fiscal do item. Não tocar. |
| `pedidosService.ts:676` | `enriquecerItemViaAlvo` | **`0`** | Idem, e é outro valor. Não tocar. |
| **`pedidosService.ts:1278`** | **`montarPayloadPedComp`** | `1` | **É o payload de CRIAÇÃO** — era o alvo do item (a), agora cancelado. |
| `alvoProjetoPedidoService.ts:245` | `buildPayload` | `1` | **Módulo Projetos**, outro payload. Acompanha `CodigoIndEconomico: "0000001"` fixo (`:254`) — Projetos declara BRL, Suprimentos omite. |

⚠️ Buscar por `ValorCambio` devolve 4 acertos e **só um é payload de criação**. Os dois de
`enriquecerItemViaAlvo` já enganaram uma vez.

### 14.7 `NumeroCtrlProjeto` — o argumento que o matava foi REFUTADO

**MEDIDO:** null em **4.139 de 4.139** leituras (3 meses, 1.281 pedidos) e **0 de 158** payloads.
**Preservação INDETERMINADA — continua exigindo A/B próprio** (§7.30 e `PLANO-PROJETOS` §13.6).

🔴 **Refutado na verificação:** a objeção de que adotá-lo custaria "609 chamadas extras ao Alvo"
está **errada — o custo é ZERO**. O cron já executa `GET /ped-comp/{filial}/{numero}` para todo
pedido candidato em todo ciclo (`sync-compras-status-cron/index.ts:2046-2048`), e é desse Load
que saem as leituras do campo. O candidato volta a ser viável; o que falta é só o A/B.

Corrosão do fingerprint alternativo (`texto`): **12 de 134 (8,96%)** foram alterados no ERP.

### 14.8 Fingerprint do CLAUDE.md — texto proposto

O critério por contagem envelhece (documento diz ~1.650; hoje 1.977) e **já quase interrompeu
uma sessão** por falso positivo. O critério por "tabelas características" foi **refutado**: não
temos acesso aos outros 3 projetos da conta para provar exclusividade. Texto sugerido:

> **Identificação do projeto (fingerprint).** A identificação **primária e suficiente** é o
> **`project_ref = hbtggrbauguukewiknew`** — na URL do MCP e no `--project-ref` explícito do
> CLI. `current_database()` **não** identifica o projeto (todos retornam `postgres`).
> Como sanidade secundária, `select count(*) from compras_pedidos` deve retornar um valor **na
> casa dos milhares e crescente** (ordem de 2.000 em ago/2026). ⚠️ **O número exato NÃO é
> critério** — ele muda todo dia e já produziu falso "projeto errado". Divergir da faixa é
> motivo para conferir, nunca para parar sozinho; divergir do `project_ref` é PARE.

### 14.9 Ordem de execução aprovada (Pedro, 27/08/2026)

1. **§14.2** — 6 requisições rebaixadas sem auditoria. *Escrita não rastreada contamina toda
   medição de status de requisição, inclusive as desta varredura. Única classe com essa
   propriedade.*
2. **§14.1** — `tipo`. *Ativo e crescente, mas estável e conhecido: não piora de natureza
   enquanto espera.*
3. **§7.28-A** — observabilidade (gravar `resposta_alvo`). *Barata e desbloqueia os demais: sem
   ela, 28-B e vários da §14 seguem infalsificáveis.*
4. **§14.6(a)** — parar o `ValorCambio: 1` hardcoded.
5. **Dupla convenção do `percentual` + §14.5 (wizard)**, juntos.

**Fechados sem trabalho:** §7.25 e §7.26.
**Por último:** §7.29 (exposição zero), §14.7 (precisa de A/B, não de código), §7.27 (chip).

### 14.10 🔴 CARD 6 — `/ped-comp/insert` fora da `NAO_REPETIR` do gateway

**MEDIDO** no `erp-proxy` em `origin/main` (`fc5d549`), lido por `git show` — o clone local está
em `45db047` e **não foi alterado** (o erp-proxy é editado só pelo Pedro, via GitHub Web).

`callAlvo` (`src/alvo-client.ts`) **repete a chamada automaticamente** em **401/403/409**,
invalidando o token e refazendo o POST:

```
if (isAuthError(firstAttempt.status) && !NAO_REPETIR.has(endpoint.split("?")[0])) { … }
```

O `Set NAO_REPETIR` existe justamente para impedir repetição onde ela causa efeito colateral, e
o comentário do próprio código diz por quê: *"a primeira chamada pode ter baixado estoque antes
de o erro voltar, e o retry baixaria de novo"*. Mas ele contém **apenas**
`ReqMat/ValidarAtendimento` e `ReqMat/FinalizarAtendimento`.

🔴 **`PedComp/SavePartial` NÃO está na lista** — logo `/ped-comp/insert` (`action=Insert`, o
caminho de **criação de pedido do módulo Projetos**) **é repetido automaticamente**. Se a
primeira tentativa criou o pedido no ERP **antes** de devolver 401/403/409, o retry cria um
**segundo pedido**. É a mesma família da **§38.6 do `Requisicoes_e_Compras.md`** (bug de
duplicação no gateway), agora **medida no `callAlvo`** e não no handler.

⚠️ O retry **não é novidade do último deploy**: o diff `45db047→fc5d549` apenas **acrescentou
exclusões**; o comportamento para `SavePartial` é o mesmo de antes.

**ESCOPO — INVESTIGAÇÃO, não correção.** A pergunta que decide a prioridade:
**existe caso histórico de pedido duplicado no Alvo compatível com retry** — dois pedidos de
mesmo fornecedor, mesmo valor, dentro do mesmo minuto?
- **Se NÃO houver:** risco **latente**, entra **depois do 4º** da ordem (§14.9).
- **Se houver:** **sobe** na ordem.

✅ **RESPONDIDO em 28/08/2026 — NÃO há caso histórico. Risco LATENTE; não sobe na ordem.**
Diagnóstico e os dois diffs propostos em `docs/erp-proxy/CARD-F-nao-repetir-criacao.md` (`b2cc8f7`).
**Método (série completa, não amostra):** o cabeçalho `[Hub] … | dd/mm/aaaa hh:mm | ID: xxxxxxxx`
que o Hub carimba em `Texto` é gerado **uma vez por envio**; dois pedidos com o cabeçalho idêntico
vieram do mesmo payload. Cobertura: **134 de 134** pedidos criados no Hub carregam o fingerprint.
Resultado: **2** cabeçalhos repetidos em toda a base, e os **dois refutados** — em ambos o gêmeo tem
`DataPedido` de **outro dia** e `CodigoUsuario` de **outra pessoa** do ERP, o que um retry (mesma
requisição HTTP, mesmo payload) não produz. Assinatura de **cópia manual dentro do ERP**. Do lado
das requisições, **zero**. Limite declarado: o gêmeo só aparece se o cron o descobrir — é
"nenhum caso encontrado", não "nunca aconteceu".

🔴 **O ACHADO É MAIOR QUE O CARD — e a parte maior não é a que ele aponta.**
`callAlvoMultipart` **não consulta a `NAO_REPETIR` em momento nenhum** (`src/alvo-client.ts`), então
acrescentar endpoints ao Set não alcança o lado multipart. São **6** caminhos de criação repetidos
hoje, e o do card é o de **menor** exposição:

| Rota | Endpoint do Alvo | Cliente | Por onde repete | Exposição |
|---|---|---|---|---|
| `/ped-comp/insert` | `PedComp/SavePartial?action=Insert` | Projetos | `callAlvo`, fora do Set | **4 envios** |
| `/ped-comp/insert-multipart` | `pedComp/SaveMultiPart?action=Insert&…` | **Suprimentos** | `callAlvoMultipart`, **sem Set** | **134 pedidos** |
| `/req-comp/insert` | `ReqComp/SavePartial?action=Insert` | Suprimentos | `callAlvo`, fora do Set | parte dos 226 |
| `/req-comp/insert-multipart` | `ReqComp/SaveMultiPart?action=Insert` | Suprimentos | `callAlvoMultipart`, **sem Set** | idem |
| `/mov-estq/save` | `MovEstq/SaveMovEstqMultPart?action=Insert` | Notas de serviço | `callAlvoMultipart`, **sem Set** | — |
| `/cartao`, `/intercompany` ×3 | `DocFin/SavePartial?action=Insert` | Cartões, Intercompany | `callAlvo`, fora do Set | — |

⚠️ `MovEstq/SaveMovEstqMultPart` é **literalmente o caso que o comentário do Set descreve**
(baixa de estoque) e está do lado que não consulta o Set.
⚠️ Grafia: `pedComp/SaveMultiPart` com **p minúsculo**, contra `PedComp/SavePartial`. `Set.has` é
sensível a caixa.

**Nota de execução:** a correção, se vier, é **uma linha no `erp-proxy`** (acrescentar
`PedComp/SavePartial` ao Set) — e **o erp-proxy é editado exclusivamente pelo Pedro, via GitHub
Web**. Diagnóstico e texto da mudança saem daqui; a edição não.
⚠️ Atenção ao escopo do Set: a chave é `endpoint.split("?")[0]`, então incluir
`PedComp/SavePartial` alcançaria **`action=Insert` E `action=Update`** de uma vez — o
`/ped-comp/update` (envio para aprovação) perderia o retry junto. Decidir se isso é desejado:
no `Update` o retry é provavelmente inócuo (setar um flag duas vezes dá o mesmo resultado), e
perdê-lo pode reintroduzir falhas de token que hoje se resolvem sozinhas.

---

## 15. Sessão de execução de 28/08/2026 — Trilha 1 (implementação) e Trilha 2 (medição)

> **Trilha 1 implementada e commitada. Trilha 2 parou no diagnóstico, como combinado.**
> Todo acesso ao banco nesta sessão foi **SELECT**. Nada foi escrito no banco.
> Verificação adversarial por item: **quem produziu o achado não o validou**.

### 15.1 Commits — um por card, mais a rodada de correção

| Card | Commits | O que entrou | Precisa de |
|---|---|---|---|
| **A** — wizard de Projetos + loader | `56be472` → **`6c21753`** | `validarLinhasRateio` recusa linha em branco e par (classe, CC) repetido nos dois portões · `montarRateioDoItem` resolve a dupla convenção do `percentual` | **Publish** |
| **D** — chip do rateio (§7.27) | `d1c6439` | `rotuloCcsDistintos` conta CCs distintos, não linhas; singular/plural num lugar só | **Publish** |
| **C** — auditoria do cron (§14.2-A defesa b) | `9171141` → **`3c33735`** | os **três** inserts de auditoria do cron passam a checar `error` · `BUILD_TAG` novo | ⚠️ **deploy da Edge Function** |
| **E** — consolidação no Projetos (§7.29) | `8635ae0` → `3150959` → **`c3dd36c`** | `consolidarRateioProjeto`, escopo estreito, agrupamento local | **Publish** |
| **B** — identidade nas requisições (§14.4) | `c6984e1` → **`9c957ff`** | regra D-17: sem `alvo_usuario`, o envio PARA; login normalizado e validado | ⛔ **Publish BLOQUEADO** — ver §14.4 |
| **F** + SQLs | `b2cc8f7` → **`cc300f1`** | diff do erp-proxy (não aplicado) + `SQL-14.2A` + `SQL-14.4` | Pedro executa |
| Trilha 2 | `cb62df9` | `docs/TRILHA2-DIAGNOSTICO-2026-08-28.md` | — |

**Verificação a cada commit:** `tsc --noEmit -p tsconfig.app.json` limpo · `bun run build` limpo ·
suite subiu de 32 para **59** testes passando. Os **7** que falham em `sidebar-ordem.test.tsx` são
**pré-existentes e falham no HEAD**. Lint conferido contra a baseline do HEAD arquivo a arquivo:
zero erros novos.

### 15.1-A 🔴 A rodada de correção — o que a verificação adversarial derrubou

Cada card foi revisado por quem **não** o escreveu, com o prompt mandando derrubar. Quatro achados
eram reais e foram conferidos por mim no MCP antes de qualquer conserto. **Vale mais registrar isto
do que a entrega limpa:**

| Card | O que estava errado | Como se sabe |
|---|---|---|
| **A** | A fatia da classe dividia por `quantidade × valor_unitario`. O rateio do Alvo **nem sempre é contra essa base** — no 0004640 é contra o valor COM IPI. **38 dos 598 itens monoclasse** sairiam de 100%, de 0,10% a 115,01%. **Consertava 2 e quebrava 38.** Denominador certo: a soma dos valores do próprio item — 0 quebrados, e os 2 multiclasse fecham em 100,00 | remedido no MCP, série completa, 600 itens de espelho |
| **C** | Consertei o insert do **Job 1**, que é inalcançável, e deixei **dois irmãos no Job 4** — um deles ALCANÇÁVEL e que **explica as 6 requisições do §14.2**, o outro (`descoberta_alvo`) **falhando há três meses**: 0 linhas gravadas e **69 requisições sem nenhuma auditoria** | `git log -S`, leitura do Job 4 e contagem no MCP |
| **E** | O `console.warn` de "validação contornada" disparava no caso **banal** de uma classe com dois CCs — `consolidarRateioDoItem` funde no nível da CLASSE, certo lá e errado aqui. E o cabeçalho trocou `toFixed` por `round2` sem necessidade, deixando a soma de fechar contra `ValorTotal` em ~1,4% dos casos a mais | reprodução direta + varredura numérica |
| **F** | O predicado do fingerprint estava **ancorado** (`LIKE '[Hub]%'`) e perdeu **70 de 241** pedidos — eram 2 cabeçalhos repetidos, são 7. E os 4 pedidos da rota que o card denuncia **não têm o fingerprint `[Hub]`**: o teste tinha poder **zero** sobre ela | remedido no MCP; refeito com o fingerprint de Projetos (10 pedidos, 0 repetidos) |

Em **todos os quatro**, a *conclusão* sobreviveu e o *método* não. E em todos, a revisão mostrou
que **os testes não guardavam**: no card E, a bateria inteira (34 testes) passava contra uma
implementação `map()` 1:1 — isto é, contra o código antigo reembalado.

### 15.2 ⛔ O que trava o Publish

**O commit `c6984e1` não pode ser publicado sozinho.** Ele faz o envio de requisição falhar para
quem não tem `profiles.alvo_usuario`, e **30 das 32 pessoas** que enviam requisição não têm — 197
dos 226 envios (87%). Push só mexe no preview do Lovable; o app publicado só muda com o Publish
manual, então o bloqueio está exatamente aí. Rode antes o `docs/SQL-14.4-alvo-usuario-requisicoes.sql`
(ou decida pela saída B, o login de serviço único, que exige uma linha de código ainda não escrita).

Os outros quatro commits de frontend (`56be472`, `d1c6439`, `8635ae0`, e este) **podem ser
publicados sem depender do SQL**.

### 15.3 Regra nova que esta sessão produziu

🔴 **Antes de aplicar uma regra de identidade, meça quem a satisfaz hoje.** A D-17 custou zero no
módulo de Projetos porque lá havia **2** responsáveis e o `alvo_usuario` da Ana já tinha sido
preenchido pelo b5. Nas requisições há **32** pessoas e **2** com login — a mesma regra, no mesmo
repo, com a mesma justificativa, é uma correção barata num módulo e uma parada de produção no
outro. **A regra não muda; a ordem das operações, sim.**

Segunda regra, do card F: 🔴 **quando o card aponta um Set, leia quem consulta o Set.** O
`NAO_REPETIR` estava incompleto — mas o `callAlvoMultipart`, que cobre o caminho de criação **33×
mais usado**, não consultava o Set em momento nenhum. Acrescentar entradas teria dado a sensação de
correção sem tocar na parte maior. **O mesmo padrão se repetiu no card C**, no mesmo dia: consertei
o insert de auditoria do Job 1 e não olhei o Job 4, onde estava o gêmeo que já disparava.
⇒ **Consertar a ocorrência que o card cita não é consertar a classe. Procure os irmãos ANTES de
escrever "conserta a classe" no commit.**

Terceira regra, e a mais cara desta sessão: 🔴 **um teste que passa contra o código antigo não é
teste.** A bateria do card E — 34 testes, escrita por mim — passava inteira contra uma
implementação `map()` 1:1. O teste que se apresentava como prova da identidade byte-a-byte comparava
contra a fórmula do **item**, que não havia mudado, enquanto o defeito estava no **cabeçalho**.
**Critério que passa a valer: para cada teste novo, pergunte se ele falha quando a mudança é
revertida. Se não falha, ele documenta — não guarda.**

### 15.4 Trilha 2 — o que foi medido e onde parou

Detalhe completo em `docs/TRILHA2-DIAGNOSTICO-2026-08-28.md`. Resumo:

- **[G] parcelas congeladas** — **SUSTENTADO**. Assimetria de sincronização; o portão do cron é de
  presença, não de coerência. Passivo real ~35× maior que os 26. Ver §14.3.
- **[H] 26 reversões** — **SUSTENTADO**. São o mesmo evento das 63: reset do workflow de aprovação
  no ERP. O flag é transiente, não livro-razão. Ver §7.28-B.
- **[I] `enviado_aprovacao`** — **não houve envio novo.** `111` eventos, `0` com `resposta_alvo`,
  último em **27/08 12:14 UTC** — anterior ao deploy da instrumentação (`6772052`, 27/08 20:06 UTC).
  *(Conferido por mim às 28/08 11:30 UTC.)* **O `|| "Sim"` NÃO pode sair ainda.**
  🔴 Mas a refutação achou evidência **indireta e forte**, que o card não tinha: nas **138** respostas
  de `envio_sucesso` (a rota irmã `/ped-comp/insert`), `UserEnviouAprovacao` vem com JSON `null` em
  **138/138**, e o resto do objeto vem **preenchido pelo servidor** — ou seja, resposta é estado, não
  eco. Se o `/update` serializa igual, o `|| "Sim"` **dispara sempre**. Veredito correto:
  **suspeita forte, sem prova direta** — não "indeterminado". Basta **um** par ANTES/DEPOIS.
  ⚠️ Se o primeiro evento pós-deploy vier com `resposta_alvo` NULA, o suspeito é o **Publish do
  Lovable não feito**, não a instrumentação.
  📌 **Achado novo, série completa:** cruzando os **111** eventos com a primeira leitura posterior,
  **5** leem "Não" (0004231, 0004228, 0004634, 0004647, 0004717) com o bloco de aprovação zerado.
  **Piso de no-op silencioso: 5/111 = 4,50%** — piso, porque `sync_status` é log de mudança.

### 15.5 🔴 Convergência das três medições: existe escritor de `compras_pedidos` sem rastro

As três trilhas bateram no mesmo ponto por caminhos independentes. `alvoPedCompLoadService.ts`
(open-load, roda a cada abertura de card) grava `valor_total`, o jsonb `parcelas` e
`detalhes_carregados`, **sem auditoria nenhuma**. Casos associados: **0004756** (G) e **0004747**
(H, mudança de bloco de aprovação sem `sync_status` correspondente).
**Consequência que vale para tudo neste documento:** 89/63/26 (H), 26 divergentes (G) e 5/111 (I)
são todos **PISO**. Enquanto houver escritor sem auditoria, nenhum desses números é total.

---

*Atualizar este arquivo ao fim de cada card concluído.*
