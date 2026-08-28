<!--
  PROVENIÊNCIA. Produzido em 28/08/2026 na sessão de execução Trilha 1 + Trilha 2.
  Método: cada card (G, H, I) foi medido por um agente e REMEDIDO DO ZERO por um
  refutador independente, instruído a derrubar o achado — quem produziu não valida.
  Só o que sobreviveu à refutação aparece como SUSTENTADO; o que caiu aparece como
  DERRUBADO, com a razão. Todo acesso ao banco foi SELECT.

  ⛔ NADA DAQUI FOI IMPLEMENTADO. G e H eram "PARE com o diagnóstico e o plano".
     Os SQLs/patches citados são PROPOSTA, não aplicados.
-->

# Diagnóstico Final — Trilha 2

**Síntese em:** 2026-08-28 · **Projeto:** `hbtggrbauguukewiknew` (Financial Hub) · **Módulo:** Suprimentos — Pedidos
**Janela de medição:** 2026-08-28 10:57 → 11:25 UTC. Cada achado foi medido por um agente e **remedido do zero** por um refutador independente (queries próprias, não reaproveitadas).
**Universo no dia:** `compras_pedidos` = 1.978 às 10:57:58 UTC → 1.979 às 11:12:43 UTC. O cron `bicephalous` rodou às 11:00:01 UTC **durante** a sessão (total_mudaram=15, total_erros=0 — ciclo válido) e moveu denominadores entre queries; por isso todo número abaixo carrega o instante em que foi tirado.

> **Estado de implementação: NADA FOI IMPLEMENTADO.** Nenhum arquivo foi editado, nenhuma escrita foi feita no banco. G e H terminam em diagnóstico + plano. O que está escrito como SQL/patch abaixo é **proposta não aplicada**.

---

## Quadro-resumo

| # | Achado | Veredito | Confiança da refutação |
|---|---|---|---|
| **G** | Assimetria de sincronização: `valor_total` segue o Alvo a cada ciclo; `compras_pedidos_parcelas` congela atrás de um portão de **presença** | **SUSTENTADO** (e agravado) | alta — não refutado |
| **H** | As 26 reversões `Aberto→Aberto` do flag de aprovação têm a mesma causa das 63 `Aberto→Reavaliar`: reset do workflow de aprovação no ERP | **SUSTENTADO**, com uma correção de redação obrigatória | alta — não refutado |
| **I** | "Indeterminado — não existe fonte alternativa de evidência sobre o `/ped-comp/update`" | **DERRUBADO no veredito** (base factual confirmada) | alta — refutado |

Nenhum achado caiu na faixa PLAUSÍVEL: as três refutações vieram com confiança alta. Duas confirmaram, uma derrubou.

---

## 1. SUSTENTADO — G · O espelho de parcelas congela; o cabeçalho não

### Enunciado que sobrevive

`valor_total` tem sincronização **contínua** (o Job 2 do cron regrava a cada ciclo em que o Alvo muda — `supabase/functions/sync-compras-status-cron/index.ts:2283-2325`, valor na linha 2299). As parcelas têm sincronização **de uma vez só**: a única rotina que reescreve `compras_pedidos_parcelas` (`persistirItensPedido` → RPC `sync_replace_filhos_pedido`) está atrás de um portão de **PRESENÇA**, não de coerência — `index.ts:2138-2140`: `if (ped.detalhes_carregados !== true || filhosAusentes)`, com `filhosAusentes` definido em `index.ts:1504-1508` só como "jsonb nulo ou vazio". **O defeito é a assimetria, não um cálculo errado.**

### Números (denominador + hora UTC)

| Medida | Valor | Denominador | Quando (UTC) |
|---|---|---|---|
| Pedidos com parcelas locais | 365 | universo 1.979 | 11:14:08 |
| Divergentes (soma parcelas ≠ `valor_total`) | **26** | 365 | 11:14:08 |
| Soma absoluta da divergência | **R$ 240.747,29** | 26 | 11:14:08 |
| Robustez à tolerância | 26 com 0,005 · 26 com 0,01 · 26 com **1,00 real** | 365 | 11:14:08 |
| `detalhes_carregados IS TRUE` | **365/365** (portão fechado em 100%) | 365 | 11:14:20 |
| `valor_total` nulo | 0 | 365 | 11:14:08 |
| **Taxa por exposição (corrigida)** | **26/263 = 9,89%** | 263 pedidos com Load posterior à última escrita de parcelas | 11:15:57 |
| Por origem, sobre exposição | Hub 14/128 = 10,94% · Alvo 12/135 = 8,89% | — | 11:17:36 |

### Direção causal — provada pela refutação (o teste que o achado não fez)

Para cada divergente, comparou-se a soma local com o Load do Alvo **mais próximo antes/no instante da escrita das parcelas**. Nos 13 que têm esse Load, **13/13** batem exatamente (`soma_local == soma_das_parcelas_do_Alvo_na_época == ValorTotal_do_Alvo_na_época`); só o Load **atual** difere (medido 11:16 UTC, denominador 26). Exemplos: 0004674 gravou 48.600 com o Alvo em 48.600 (Load 08-19 13:01 UTC), hoje o Alvo diz 62.100; 0004757 gravou 1.586,05, hoje 453,94; 0004755 gravou 2.998,40, hoje 599,68. **Isso mata a explicação "gravou errado desde o início".** A gravação foi coerente no momento em que aconteceu; depois o Alvo moveu e só o cabeçalho seguiu.

### Explicações alternativas mortas (todas com denominador)

- **"valor_total inclui frete/IPI, as parcelas não":** no último Load, `ValorTotal == soma(ParcPagPedCompChildList)` em **25 de 26** (11:16 UTC). Única exceção: 0003872 (13.900 × 17.514) — incoerência do próprio ERP.
- **"as parcelas somam `valor_mercadoria`":** explica no máximo **3 de 26** (11:14:20 UTC).
- **"congelar é by design, é registro do que foi enviado":** **12 dos 26** têm `criado_no_hub=false` e `enviado_em=null` — nunca foram enviados pelo Hub; as parcelas vieram só do espelho.
- **Fallback fabricando divergência:** `resolverValorTotalAlvo` (`index.ts:260-275`) só cai no fallback quando `ValorTotal` é null ou 0. Descartado por leitura de código.
- **Escritor oculto:** 0 triggers não-internos em `compras_pedidos` / `_parcelas` / `_itens`; **uma única** função em `pg_proc` escreve `compras_pedidos_parcelas` (`sync_replace_filhos_pedido`, `SECURITY DEFINER`, `menciona_valor_total = FALSE`) — 11:17:36 UTC.

### Série temporal — o portão abriu uma vez e fechou

Sobre os 365 (11:15 UTC): **247** têm a última parcela escrita em **2026-08-20** (backfill de massa do card C3, que encheu os jsonb e fechou o portão). De 08-21 a 08-28, 70 escritas — mas em pedido **preexistente**, apenas **3** (11:15:48 UTC). Taxa de reescrita ~1% em 8 dias: o caminho existe e está praticamente morto.

### O que a refutação **acrescentou** (e piora o quadro)

1. **O passivo é ~35× maior do que os 26.** Fora dos 365 há **1.614** pedidos sem parcelas locais; destes, **902 TÊM parcelas no último Load do Alvo**, **1.548** já estão com `detalhes_carregados=true` e **1.164** com o jsonb `parcelas` cheio (denominador 1.979, 11:17:50 UTC). O mesmo portão de presença impede que **~900 pedidos jamais recebam parcelas na tabela**. O achado listou isso como indeterminado (honesto), mas o número que circula é 26.
2. **A tabela congelada é o que a tela mostra e o que a edição reenvia ao ERP.** `_carregarPedidoCompleto` (`src/services/pedidosService.ts:2268`, usada por `carregarPedidoParaDetalhe` **e** `carregarPedidoParaEdicao`) lê a **tabela** e só cai no jsonb quando ela está vazia. A defasagem não é interna: sai pela UI e pode voltar ao ERP numa edição.
3. **Cisão entre os dois espelhos, medida:** em **9** dos 365 o jsonb `compras_pedidos.parcelas` está coerente com `valor_total` e a tabela está divergente (11:01 UTC). Mesmo Load, dois destinos, só um atualizado.
4. **Divergência de contagem, não registrada antes:** 0004635 (12 parcelas no Alvo × 1 local), 0004229 (2 × 1), 0004495 (18 × 36) — 11:16 UTC.
5. **Indeterminado #4 resolvido:** `sync_replace_filhos_pedido` tem `anon_pode_executar = 0` em `aclexplode` (11:17:36 UTC) — já está revogada de `anon`.
6. **Correção a favor do achado:** `vt_hub == vt_ult_load` em **25/26**, não 24/26 (única exceção 0004756, o caso já marcado como inexplicado).
7. **Correção de método aceita:** a "exposição real" do relatório original (26/365 = 7,12%) era a mesma medida reescrita, não normalização por oportunidade. A taxa correta é **26/263 = 9,89%**.
8. **Argumento inválido, conclusão certa:** o `UNIQUE (pedido_id, sequencia)` citado para descartar duplicação em 0004495 não prova nada (não impede duplicata renumerada). A conferência linha a linha confirma **freeze**: 36 vencimentos mensais distintos de 2026-08-25 a 2029-07-10, todas com `created_at` 2026-07-23 14:06 UTC, contra 18 parcelas somando R$ 55.000,00 no Alvo hoje.

### Ressalvas ao plano (não ao achado)

- **O Passo 1 não é suficiente.** O SELECT de candidatos (`index.ts:2087-2093`) exclui status terminais quando `detalhes_carregados=true` e corta 180 dias. **10 dos 26 divergentes estão em status terminal** (11:14:20 UTC): acrescentar `|| valorMudou` ao portão **não os alcança**, porque eles nem chegam a ser candidatos. Já pôr `detalhes_carregados = false` (Passo 4) reabre a elegibilidade pelo ramo `detalhes_carregados.not.is.true` e funciona para eles.
- **O Passo 2 cai de prioridade.** `load_sem_parcelas = 0` no universo (11:15:57 UTC): o "buraco do zero parcelas" na RPC é **risco teórico, não passivo observado**. Continua valendo corrigir com parâmetro novo e opcional (nunca mudando o default — apagar por padrão destruiria parcelas de todo Load parcial), mas depois dos outros.
- **Risco real do Passo 4/1 não está nas parcelas:** a RPC também apaga `compras_pedidos_itens_rateio` antes de reinserir. Snapshot obrigatório precisa cobrir rateio.
- **Exceção a não reprocessar:** 0003872 — o próprio Alvo está incoerente. Espelhar não resolve; é correção no ERP.

---

## 2. SUSTENTADO — H · As 26 reversões `Aberto→Aberto` são o mesmo evento das 63

### Enunciado que sobrevive (com a correção de redação exigida)

Em **22 das 26** reversões `Aberto→Aberto`, a **mesma leitura** que registra `UserEnviouAprovacao` "Sim"→"Não" registra o **bloco inteiro de aprovação do Alvo sendo zerado**: `StatusAprovacao` 'Em Andamento'→'Nenhum', `UserProximoAprovador`→null, `UserEnviarAprovacao`→'Não'. Não é um flag caindo sozinho: é o **workflow de aprovação do ERP sendo resetado**, **sem mudança de status _observada_**.

> **Correção obrigatória de redação:** trocar "só que sem a mudança de status" por **"sem mudança de status OBSERVADA"**. Ver a alternativa não testada abaixo.

### Números (denominador + hora UTC)

| Medida | Valor | Denominador | Quando (UTC) |
|---|---|---|---|
| Reversões, série congelada `created_at < 2026-08-28 11:00:00+00` | **89** = 63 `Aberto→Reavaliar` (59 pedidos) + 26 `Aberto→Aberto` (23 pedidos) | 2.922 pares expostos | 11:14 (remedido) |
| Reversões ao vivo | 91 = 63 + **28** (25 pedidos) | — | 11:14 |
| Destinos possíveis | **exatamente 2** — nenhuma reversão para Encerrado/Cancelado/Cancelado Parcial/Pendente | GROUP BY completo | 11:14 |
| Assinatura do mecanismo | **22/44 = 50,00%** | pares `Aberto→Aberto` com `StatusAprovacao` 'Em Andamento'→'Nenhum' | 11:14 |
| Controle (as outras 9 transições somadas) | **4/1.932 = 0,21%** | idem, demais transições | 11:14 |
| Normalização adicional (por pedido-hora) | **15,918 × 0,027** por 1.000 pedido-hora = **590×** | 1.382 h × 147.560 h | 11:14–11:25 |
| Universalidade | **63/63** das `Aberto→Reavaliar` terminam com `StatusAprovacao='Nenhum'` | 63 | 11:14 |
| `UserProximoAprovador → null` | 23/26 (88,46%) contra 26/1.950 (1,33%) nos não-reversores | 1.976 pares | 11:14 |
| Desfecho | **24/24** com leitura posterior voltaram a "Sim" na próxima leitura; **0** seguiram em "Não" | 26 (2 sem leitura posterior) | 11:14 |
| Redundância dos campos | `UserEnviouAprovacao` × `UserEnviarAprovacao` concordam em **4.311/4.313** (99,95%) | leituras com ambos preenchidos | 10:57–11:07 |
| População viva afetada | **21** pedidos `Aberto` + `Não` + `Nenhum`; **30** com flag nula + `Nenhum` + `Aberto` | `compras_pedidos`, 1.979 | 11:14 |

**Reprodução ao vivo:** às 11:00:36 UTC, no ciclo daquela hora, 0004786 e 0004785 reverteram com **assinatura idêntica** ('Em Andamento'→'Nenhum', HUGO.MAFFEI→null, `UserEnviarAprovacao`→'Não'). O padrão se reproduziu durante a própria medição.

### Segundo achado sustentado: o flag é **transiente**, não um fato durável

`UserEnviouAprovacao` é, na prática, **cópia do campo de comando** `UserEnviarAprovacao` (99,95% de concordância; nos 44 pares de reset a coincidência é perfeita — nos 22 que reverteram ambos foram a "Não"; nos 22 que não, ambos ficaram "Sim"). Tratar o campo como memória de "já foi enviado" é ler um espelho de estado momentâneo como se fosse livro-razão. Intervalo até a leitura de retorno: mín 4,0h · mediana 18,0h · máx 150,0h — **limite superior** da duração real, não a duração.

### Consequência viva (o único caso persistente)

**0004467** (`e10a63a7-2f33-4b84-81e0-8f435dc0a535`) reverteu em **2026-07-24 15:00:36 UTC** e nunca voltou. Estado confirmado pelas duas medições (`synced_at` 2026-08-27 18:01 UTC): `status='Aberto'`, `enviou_aprovacao='Não'`, `status_aprovacao='Nenhum'`, `proximo_aprovador=null`. **35 dias parado, cadeia zerada, ninguém pendente.**

### Objeção que deve andar ao lado do achado (única que pegou, e só parcialmente)

**"Ciclo Reavaliar escondido":** o pedido pode ter entrado em `Reavaliar` e voltado **entre duas leituras**, e o grupo `Aberto→Aberto` ser apenas o grupo `Aberto→Reavaliar` visto com gap maior. Não é exótica — tem mecanismo observado:
- `Reavaliar` é efêmero: **70 de 83** entradas já sumiram na leitura seguinte (mediana 20,5h).
- O estado de retorno do Reavaliar **é** a assinatura das 26: dos 71 pares `Reavaliar→Aberto`, **25** caem em (flag 'não', SA 'Nenhum', prox null).
- As 26 têm gaps maiores (mediana 25,0h × 18,0h; p25 19,0h × 4,0h) — a direção que um artefato de invisibilidade preveria.
- A cadência de leitura **não é horária**: `PED_BATCH_SIZE=100` (`index.ts:249`) num rodízio `synced_at ASC` com ~379–517 elegíveis ⇒ cada pedido é lido a cada ~4–5 ciclos.

**Mas ela é minoritária, quantificada:** taxa base de entrada em Reavaliar = **0,2511 por 1.000 pedido-hora** de exposição (266.788 pedido-hora, 67 entradas visíveis). As 26 janelas somam **1.476 pedido-hora ⇒ 0,37 entradas esperadas** — antes mesmo de exigir ida **e** volta dentro da janela. Explicar a maioria das 26 exigiria fator de correção ~50×. Somam-se: **17 dos 23** pedidos do grupo nunca mostram `Status='Reavaliar'` em toda a série, e **0 das 26** têm a leitura seguinte em Reavaliar. E, decisivo: **mesmo se fosse verdade, tornaria os dois grupos o mesmo evento — que é a tese principal do achado.**

### Correções de método aceitas dentro de H

- **"`sync_status` e `descoberto_alvo` são os únicos com `PedCompUserFieldsObject`" é FALSO:** `envio_sucesso` também tem (138 eventos). **Imaterial para H** — os 138 têm flag NULL e **zero** sucedem uma leitura "Sim", série e denominadores intactos. **Material para I** (§3).
- **"voltaram a 'Sim' SOZINHAS" exagera:** 2 das 24 tiveram ação do Hub (`enviado_aprovacao`/`envio_tentado`/`editado_hub`) dentro da janela de retorno ⇒ **22/24** sem ajuda. O 24/24 de *retorno* está certo, e **0/26** tiveram ação do Hub na janela da *reversão*.
- **"fator ~240×" convida a leitura causal não conquistada:** o estrato usa `StatusAprovacao` medido na **mesma leitura** que define a reversão ⇒ é **co-ocorrência/simultaneidade**, não razão de risco preditiva. A redação substantiva ("a mesma leitura registra o bloco inteiro sendo zerado") está correta; o número deve vir rotulado como tal.

### Hipóteses **derrubadas** dentro de H (não apresentar como achados)

| Hipótese | Veredito | Razão, com denominador |
|---|---|---|
| (a) Concentra-se em aprovadores específicos | **refutada** | O zero de FLAVIO.DIAS é **artefato de exposição**: seus 376 pares têm `StatusAprovacao='Nenhum'` na leitura do "Sim" — nunca esteve exposto ao reset. Condicionando a `sa_prev='Em Andamento'`: HUGO 38/585 = 6,50%; FERNANDO 6/276 = 2,17% |
| (c) Horário / dia da semana | **refutada** | Nenhuma hora/dia acima da flutuação de Poisson (maior: quarta, 9 eventos × 4,9 esperados). E a hora da **leitura** não é a hora do **fato** (mediana ~24h entre leituras nestas 26) |
| (d) Concentração em ciclos do cron (falha de leitura do Hub) | **refutada** | 26 reversões em 21 de **766** ciclos; nenhum lote em massa; o maior (2026-07-16 19:00 UTC) teve 444 consultados, `total_mudaram=8`, `total_erros=0` — ciclo saudável. Há sobredispersão (~14×), mas os co-ocorrentes compartilham **requisitante e aprovador**, não fornecedor/requisição ⇒ ação em bloco no ERP |
| (e) O Hub é o gatilho | **refutada** | **0 de 89** reversões têm evento `enviado_aprovacao` do Hub **dentro da janela** [leitura do "Sim", leitura do "Não"]. (Corrige o card 28 no enunciado: 7 das 26 e 11 das 63 estão em pedidos que **já tiveram** evento do Hub antes — 7/246 = 2,85% × 19/1.730 = 1,10%, razão 2,6× com n=7, insuficiente) |
| Os dois campos `User*Aprovacao` carregam informação independente | **refutada** | 99,95% de concordância; a janela sistemática "comando enviado, execução pendente" **não existe** (2 leituras em 4.313) |

### Bomba armada (achado colateral, não corrigido)

`sameStr` (`index.ts:2237-2241`) normaliza apenas `''`/`undefined` para null e compara com `===` — **não normaliza acento**. Hoje só chega "Não" com til (verificado por hex: `4ec3a36f`, n=182; "Sim" `53696d`, n=4.145; NULL n=445 — zero variantes sem til em 2026-08-28 11:12 UTC). Se o Alvo passar a devolver "Nao" sem til, **cada ciclo gravaria uma mudança fantasma**.

---

## 3. DERRUBADO — I · O veredito "indeterminado, não há fonte alternativa"

### O que foi derrubado, e por quê

O achado I concluiu **"indeterminado — sem envio novo desde a instrumentação; não existe fonte alternativa de evidência sobre o que o `/ped-comp/update` devolve; hoje não há como distinguir 'não publicado' de 'não usado'"**. A refutação (confiança **alta**) derruba exatamente essa **afirmação de exclusividade**: duas séries estavam na própria `compras_pedidos_auditoria` e **não foram consultadas**.

1. **A rota irmã de escrita responde a pergunta por analogia forte.** O evento `envio_sucesso` guarda a resposta crua do `POST /ped-comp/insert`: **138 respostas** capturadas (2026-05-25 → 2026-08-27), todas com o PedComp inteiro (200+ campos). O payload manda `PedCompUserFieldsObject: {}` (`src/services/alvoProjetoPedidoService.ts:449`, com comentário explícito de não repor campos de aprovação) e a resposta volta com o UFO de **10 chaves preenchido pelo servidor** em **138/138** — incluindo `UserProximoAprovador` derivado pela cadeia do ERP, `Numero` atribuído pelo Alvo, `DataHoraDigitacao` e `CodigoUsuario`. Na família `/ped-comp` de escrita, **resposta é estado, não eco**.
2. **E a evidência aponta contra o `|| "Sim"`, não a favor.** Nessas mesmas 138 respostas, a chave `UserEnviouAprovacao` está **presente com valor JSON `null` em 138/138** (verificado com `jsonb_typeof = 'null'`, não com `->>` ambíguo). Se o `/ped-comp/update` serializa o mesmo UFO do mesmo jeito, então `respPedido?.PedCompUserFieldsObject?.UserEnviouAprovacao` é `null` e o **`|| "Sim"` (`src/services/pedidosService.ts:2780`) dispara sempre**, gravando "Sim" tenha o ERP agido ou não.

**Veredito correto: "SUSPEITA FORTE, ainda sem prova direta" — não "indeterminado".**

### O que continua **sustentado** dentro de I (base factual, reproduzida número a número)

- `compras_pedidos_auditoria WHERE evento='enviado_aprovacao'`: **111 eventos**, `count(resposta_alvo)=0`, `count(payload_enviado)=0`, `max(created_at)=2026-08-27 12:14:10.728661 UTC` (medido 10:57 UTC, reproduzido 11:17:44 UTC).
- Commit 6772052 = **2026-08-27 20:06:50 UTC** (17:06 BRT). Último evento de qualquer tipo antes da 1ª medição: 2026-08-27 20:00:56.841393 UTC. **Zero eventos pós-deploy.**
- **A ausência é real, não artefato de horário:** às 11:17:44 UTC, **depois** do ciclo das 11:00, `enviado_aprovacao` continuava em 111 e os eventos pós-deploy eram só `descoberto_alvo` e `sync_status`.
- Taxa histórica **70 eventos / 14 dias úteis (07/08–27/08) = 5,0/dia útil** — bate exatamente. Oportunidade remanescente: 739 (10:57 UTC) → **741** (11:17 UTC).
- O achado está certo ao dizer que o valor atual de `compras_pedidos.enviou_aprovacao` **não serve de traço**: o cron sobrescreve a coluna (`sync-compras-status-cron/index.ts:2330`, dentro do `mudou=` da linha 2297) e a auditoria não cobre `enviou_aprovacao` nas colunas anterior/novo.
- A instrumentação está **bem construída** (snapshot `ufoAntes` tirado antes da mutação in-place; `payload_enviado` + `resposta_alvo` gravados) — só não foi exercitada.

### Achado NOVO que sai da refutação de I — consequência medida, série completa

Cruzando **cada um dos 111** eventos `enviado_aprovacao` com a **primeira leitura posterior** do Alvo do mesmo pedido (cobertura 111/111, sem órfão, medido 2026-08-28 11:17:44 UTC):

- **106 → `UserEnviouAprovacao="Sim"`** (latência mín 1,46h · mediana 4,75h · máx 68,81h)
- **5 → `"Não"`** (mín 17,06h · mediana 17,40h · máx 18,99h): **0004231, 0004228, 0004634, 0004647, 0004717**. Nesses 5, `UserEnviarAprovacao` também voltou "Não" e `StatusAprovacao` "Nenhum" — **o ERP não guardou nem o flag que o Hub escreveu**, e os 5 estão registrados no Hub com sucesso.
- **2 nunca entraram na cadeia:** 0004231 seguia "Não"/"Nenhum" em 2026-08-27 13:00 UTC (2,4 meses depois); 0004228 em 2026-07-01 17:00 UTC.

**Piso do no-op silencioso: 5/111 = 4,50%.** É piso pela regra 3 (`sync_status` é log de mudança, não amostragem).

### Ressalvas que ficam a favor do achado original

- `/ped-comp/insert` ≠ `/ped-comp/update` (rotas distintas no gateway) ⇒ os itens (1) e (2) são **analogia forte, não prova**. O par ANTES/DEPOIS continua necessário.
- `/ped-comp/update` tem **caller único** em todo o repo (`pedidosService.ts:2775`) — não há fonte direta alternativa; a fonte encontrada é indireta.
- A ressalva do achado permanece válida: **se o primeiro evento pós-deploy vier com `resposta_alvo` NULA, isso indica Publish manual do Lovable não feito (ou bundle em cache), não falha da instrumentação.**
- **Retratação registrada pelo próprio refutador:** a leitura de `proximo_aprovador='FLAVIO.DIAS'` nos 5 discordantes como prova de que o `/ped-comp/update` devolvia estado estava **errada** — a série completa mostra FLAVIO.DIAS entrando pelo `envio_sucesso` (insert, `pedidosService.ts:1953`), antes. Descartada.
- **A lista de eventos do briefing está incompleta:** existem também `enviar_aprovacao_falhou` (n=1, 2026-08-13), `criado_hub`, `req_baixada`, `editado_hub`, `excluido_alvo`.

---

## 4. Convergência das três trilhas: existe um escritor de `compras_pedidos` sem rastro

As três trilhas, independentes, bateram no mesmo ponto:

| Trilha | Evidência |
|---|---|
| **G** | O open-load do frontend (`src/services/alvoPedCompLoadService.ts:407-461`) grava `valor_total` (419), o jsonb `parcelas` (410) e `detalhes_carregados:true` (432), **nunca toca `compras_pedidos_parcelas`** (grep confirmado) e **não grava auditoria**. Roda a **cada abertura** de card de detalhe (`src/pages/SuprimentosPedidoDetalhe.tsx:237`). É ele que fecha o portão do cron. Caso associado: **0004756**, `valor_total` R$ 11.709,10 contra R$ 8.830,00 no último Load logado — infalsificável enquanto não houver auditoria. |
| **H** | **0004747** reverteu em 2026-08-26 12:00:44 UTC e hoje está `Sim`/`Em Andamento`/`HUGO.MAFFEI` em `compras_pedidos` **sem evento `sync_status` do retorno**, apesar de `enviou_aprovacao` estar no teste `mudou` (`index.ts:2297`). `updated_at = 2026-08-27 12:04:44 UTC`, enquanto o ciclo das 12:00 rodou 12:00:05→12:00:53 (47,8s, 516 consultados, 0 erros) — **fora de borda de ciclo**. |
| **I** | A auditoria de `sync_status` não cobre `enviou_aprovacao` nas colunas anterior/novo ⇒ a transição do fallback **não é reconstruível pelo log**, mesmo quando gravada. |

**Consequência transversal:** 89/63/26 (H), 26 divergentes (G) e 5/111 (I) são todos **PISO**. Enquanto houver escritor sem auditoria, nenhum desses números pode ser chamado de total.

> Hipótese **não testada** para o 0004747: o conjunto exato de colunas que mudou (`enviou_aprovacao` + `status_aprovacao` + `proximo_aprovador`) é exatamente o que `enviarPedidoParaAprovacao` grava (`pedidosService.ts:2740` e `2782`) — mas essa função grava auditoria e não há evento correspondente. Não force conclusão: **INDETERMINADO**, exige rastreio dos writers fora do cron.

---

## 5. INDETERMINADO — e qual dado faltaria para decidir

| # | Questão em aberto | Dado que falta |
|---|---|---|
| 1 | **Quem/o quê** altera o pedido no Alvo (valor em G, reset de workflow em H). `DataHoraDigitacao` não mudou em 0/22 e `ValorTotal` mudou em 1/22 ⇒ **não foi reedição**. `PedCompJsonReprovChildList` é array vazio em 4.017 de 4.023 leituras ⇒ não serve de histórico | Log de auditoria do lado do Alvo (autoria + timestamp da alteração dos campos de aprovação). Não vem no `DocFin/Load` nem no `PedComp/Load` |
| 2 | **O tamanho real do passivo de G.** ~900 pedidos com parcelas no Alvo e nenhuma local — não sei quantos **deveriam** ter | Critério de negócio: quais tipos/status devem ter parcelas espelhadas. Sem isso, "900" é elegibilidade técnica, não passivo confirmado |
| 3 | **0004756** (G) e **0004747** (H): duas escritas sem rastro não casadas com nenhum evento | Auditoria no open-load; rastreio dos writers de `compras_pedidos` fora do cron |
| 4 | **Por que só metade dos resets zera o flag** (22 de 44 pares 'Em Andamento'→'Nenhum'). A separação é perfeita entre os dois campos `User*`, mas nada no payload distingue os subgrupos | Leituras mais densas. Com mediana de 18h, é possível que os 22 "que não reverteram" tenham sido zerados e restaurados dentro do intervalo — o que tornaria o fenômeno **universal** e o 50% um artefato de amostragem |
| 5 | **Duração real do estado "Não" no ERP** — só conheço o limite superior (4,0h / 18,0h / 150,0h) | Leitura sob demanda ou webhook do Alvo. Decide se a reversão é um piscar irrelevante ou uma janela de horas em que o pedido some da fila |
| 6 | **Quanto do grupo `Aberto→Aberto` é ciclo Reavaliar escondido** — quantificado como ~0,37 de 26 pela taxa base, mas não zero | Cadência de leitura maior (batch/frequência) por um período, ou webhook |
| 7 | **Faixa de valor ≥100k** (H): 2/24 = 8,33% contra 1,32% geral, esperado 0,32. Com n=2 e 5 faixas testadas, não separo sinal de ruído | Mais histórico nessa faixa |
| 8 | **As 3 exceções de 2026-07-16 19:00 UTC** (handoff × anomalia de ciclo) estão **perfeitamente confundidas** — controle limpo (3/87 × 0/281), mas todas no mesmo ciclo | Uma segunda ocorrência em ciclo diferente |
| 9 | **O `/ped-comp/update` devolve `UserEnviouAprovacao` null como o insert?** (I) | O par ANTES/DEPOIS da instrumentação (`enviado_aprovacao` com `resposta_alvo` não-nula). Basta 1 |
| 10 | **O commit 6772052 chegou ao app publicado?** | Confirmação do Publish manual no Lovable. Pelo banco, "não publicado" e "não usado" são indistinguíveis com zero eventos |
| 11 | **Se o usuário percebe a reversão** (H): se o pedido sai da fila de "aguardando aprovação" da UI durante a janela | Leitura dos filtros de tela contra `enviou_aprovacao` |
| 12 | **Convergência dos 26 após o Passo 4/1** (G) | Exige rodar; é justamente o que o Passo 4 foi desenhado para decidir empiricamente |

---

## 6. Correções de método a carregar adiante

1. **"O conjunto A é idêntico ao conjunto B" não é normalização por exposição.** G escreveu "26 de 365, idêntico ao conjunto dos divergentes" — era a mesma medida reescrita. Denominador por oportunidade correto: 26/263 = 9,89%.
2. **Estrato medido na mesma leitura que define o desfecho é co-ocorrência, não razão de risco.** O "240×" de H deve ser rotulado como simultaneidade; a normalização por pedido-hora (590×) é a que sustenta contraste.
3. **Zero em um estrato pode ser ausência de exposição, não proteção.** FLAVIO.DIAS 0/376 virou 0/0 exposto ao condicionar por cadeia ativa.
4. **"Não existe outra fonte" precisa de busca, não de asserção.** Foi o que derrubou I: `envio_sucesso` estava na mesma tabela.
5. **Argumento certo pelo motivo errado ainda é argumento errado.** O `UNIQUE (pedido_id, sequencia)` não descartava duplicação; a conferência linha a linha, sim.
6. **Denominador que se move durante a medição precisa ser congelado e o congelamento declarado** — os dois relatórios fizeram isso corretamente e por isso são comparáveis.

---

## 7. O que eu faria a seguir, e por quê

**Card G — devolver os 26 à fila antes de tocar em código**
Snapshot de `compras_pedidos_parcelas` **e** `compras_pedidos_itens_rateio` dos 26 (a tabela não tem `updated_at`; o snapshot é a única rede), depois `detalhes_carregados=false` nos 25 (exceto 0003872, incoerência do ERP) e esperar 1–2 ciclos **dentro** de 11h–20h UTC em dia útil, aceitando só ciclo com `total_erros` baixo **e** `total_mudaram>0`.
Por quê: usa apenas o mecanismo já exercitado e **valida o diagnóstico sem alterar um arquivo** — se os 26 não convergirem, a hipótese está errada e nada foi mexido. Serve também aos 10 terminais, que o patch do portão sozinho não alcança.
Rollback: restaurar as linhas do snapshot e devolver `detalhes_carregados` ao valor guardado.

**Card G — dimensionar os ~900 antes de decidir o patch**
Medir quantos dos 902 pedidos com parcelas no Alvo e nenhuma local **deveriam** ter espelho, por status e por tipo.
Por quê: o número que circula é 26 e a ordem de grandeza real é ~35× maior; a decisão entre "corrigir o portão" e "backfill em massa" muda conforme esse denominador. Sem ele, o patch resolve 7% do problema e declara vitória.

**Card G — auditoria no open-load, antes de qualquer mudança de comportamento nele**
Fazer `alvoPedCompLoadService.ts` gravar evento de auditoria ao alterar `valor_total`/`detalhes_carregados`; **medir o ACL** antes de cogitar chamá-lo com a RPC.
Por quê: é o caminho que **todo** usuário exercita ao abrir um card, é o único escritor sem rastro identificado e já produziu um caso infalsificável (0004756). Auditar é barato e reversível; mudar o que ele escreve é a alteração mais arriscada da lista e exige teste com usuário **sem** `is_admin`.

**Card H — parar de tratar `enviou_aprovacao` como livro-razão**
Levar ao Pedro a decisão de produto: o campo é transiente (24/24 voltaram sozinhos; 22/24 sem ação do Hub) e é cópia do comando (99,95%). A fila de aprovação da UI não pode depender só dele.
Por quê: 21 pedidos hoje em `Aberto`+`Não`+`Nenhum` e 0004467 há 35 dias sem ninguém pendente. É a única consequência **viva** de H, e é de negócio, não de código.

**Card H — fechar a bomba do acento e o buraco de log**
Normalizar acento em `sameStr` (`index.ts:2237-2241`) e rastrear os writers de `compras_pedidos` fora do cron (caso 0004747).
Por quê: hoje só chega "Não" com til, mas uma variante sem til geraria mudança fantasma **a cada ciclo**; e enquanto houver escritor sem auditoria, 89/63/26 continuam sendo piso de tamanho desconhecido.

**Card I — esperar UM par ANTES/DEPOIS, e olhar os 5 já medidos enquanto isso**
Reler `enviado_aprovacao` no primeiro dia útil com envio (taxa 5,0/dia útil; 741 pedidos elegíveis) e verificar se `resposta_alvo` vem preenchida; se vier nula, investigar Publish do Lovable antes de culpar a instrumentação.
Por quê: um único evento decide se o `|| "Sim"` dispara sempre — e as 138 respostas do insert com `UserEnviouAprovacao` null em 138/138 já dão razão datada para suspeitar que sim. Enquanto isso, os 5/111 = 4,50% de no-op silencioso (0004231, 0004228, 0004634, 0004647, 0004717) são passivo real e revisável à mão hoje.

**Ordem sugerida:** G-backfill → G-dimensionar → I-esperar o par → H-produto → G-open-load → H-acento. Nenhum passo acima está implementado.