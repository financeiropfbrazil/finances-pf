# ESTADO-REVISAO-SUPRIMENTOS
### Estado vivo da missão · última atualização: 24/08/2026, após R1.2, C3.3 e SEC-1

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

*Atualizar este arquivo ao fim de cada card concluído.*
