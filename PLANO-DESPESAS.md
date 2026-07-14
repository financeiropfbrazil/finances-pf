# PLANO-DESPESAS — Documento Vivo do Módulo de Despesas

> \*\*O que é este arquivo:\*\* o plano operacional vivo do módulo Controle de Despesas do Financial Hub.
> O agente (Claude Code) \*\*lê este arquivo no início de toda sessão\*\* e o \*\*atualiza ao final\*\* de qualquer trabalho no módulo. O Pedro insere planos novos na Seção 2 (Fila de Trabalho) e o agente os executa.
>
> \*\*Especificação completa:\*\* `Despesas-Novo-v2.md` (report v2.0, 10/07/2026). Este arquivo NÃO substitui o report — é o painel de controle do dia a dia.

\---

## 0\. Protocolo de atualização (regras para o agente)

1. **Nunca apagar histórico.** Itens concluídos são movidos para a Seção 5 (Concluído) com data — não deletados.
2. **Nunca reescrever as Regras Invioláveis (Seção 4).** Só adicionar novas armadilhas descobertas, com data.
3. **Todo commit que altera este arquivo** registra uma linha no Changelog (Seção 6): data, o que mudou, por quê.
4. **Planos novos** entram na Seção 2 como cards numerados sequencialmente (`D-001`, `D-002`, ...). Um card criado **nunca é alterado** — se o plano mudar, cria-se um card de Ajuste (`D-00X-A1`) mantendo o original intacto.
5. **Validação empírica antes de assumir.** Convenção do módulo: ✅ validado · ⚠️ pendente de validação · 🔧 ação. Nada vira ✅ sem evidência (query, response, execução).
6. **Operações de banco (emendada 13/07/2026):**

   * **Leitura (`SELECT`, `EXPLAIN`) é LIVRE.** O agente executa quantas queries de diagnóstico precisar, sem pedir autorização e sem anunciar uma a uma — apresenta as conclusões, não o pedido. Encadear Query #1 → #2 → #3 numa mesma investigação é o comportamento esperado.
   * **Escrita (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`) e DDL (`CREATE`/`ALTER`/`DROP`)** seguem o rito: propor o SQL completo, aguardar aprovação explícita do Pedro, executar uma ação por vez. Migrations destrutivas jamais sem confirmação.
7. **Mês FECHADO é intocável.** A trigger `desp\_bloqueia\_rateio\_fechado` garante no banco; o agente garante no comportamento (nunca sugerir reabrir como atalho).

\---

## 1\. Estado atual (snapshot: 14/07/2026)

**Em produção:**

* `/despesas/realizado` — visão unificada MovEstq + DocFin (jan/2026 em diante; bônus: R$ 11,2M de 2025 já capturados).
* `/despesas/config-contas` — de-para contábil + fechamento de competências (admin-only).

**Placar:**

|Item|Status|
|-|-|
|Captura jan–jun/2026 (R$ 18,96M)|✅ íntegra, 0 erros|
|Cron MovEstq (`sync-despesas-3x-dia`)|✅ auto-semeadura ativa (execução 16281 comprovada)|
|Cron DocFin (`sync-docfin-3x-dia`)|✅ janela rolante 3 meses (PENDENTE nos meses recentes = comportamento projetado)|
|Plano de contas (1.235 contas, 505 analíticas de resultado)|✅ internalizado (`desp\_plano\_contas`)|
|De-para 1:1 — 112 classes|✅ mapeadas e carimbadas|
|De-para 1:N — 10 classes (≈ R$ 760k)|⚠️ aguardando desempate do Pedro, **pela tela**|
|14.10 Hospitalidade (R$ 312)|⚠️ sem conta definida|
|17.01 Aluguel/IFRS 16|⚠️ pendência conceitual (1:1 ou 1:N?) — nunca chutar|
|Trava de mês fechado (trigger + RPC)|✅ testada|
|Vazamento real jan–jun (RE-AUDITADO 14/07, anti-join real)|✅ **371 docs / R$ 1.475.637** — serviço 148/R$727,5k (inalterado) · NF-e mercadoria 198/R$592,2k · DIV 25/R$155,9k. Substitui o número da etapa 1 (391/R$2,12M). Ver D-004-A1|
|Vazamento Padrão 1 (serviço, Origem=Estoque)|✅ etapa 1 FECHADA e re-auditada: 148 docs / R$ 727,5k (confirmado idêntico). Correção fundida no D-001 (pende ORIGEM **+** allowlist **+** anti-join)|
|Vazamento mercadoria/imob. (Origem=Estoque)|✅ re-auditado: NF-e **198 docs / R$ 592,2k** + DIV 25 / R$ 155,9k (era 211/R$1,21M — os "13 NF-e Origem≠Estoque" eram 11 dupla-contagem + 2 genuínos). Fundido no D-001; D-001-A1 absorvido|
|Cobertura do Hub sobre o DocFin PAG jan–jun|29,1% do valor (R$ 6,33M de R$ 21,75M); o não-capturado é ~90% descarte legítimo (já no MovEstq + natureza)|
|Vazamento Padrão 2 (4 CT-e J.V. Brito)|❌ não investigado (provável causa no Alvo)|

**Cobertura do carimbo jan–jun:** MovEstq 86,7% · DocFin 95,4% (o gap é exatamente os 1:N + 14.10).

\---

## 2\. Fila de trabalho (cards)

### D-001 — Fase 1 / Padrão 1: medir o vazamento NFCom antes de corrigir

**Status:** ✅ etapa 1 (medição) CONCLUÍDA 13/07 e **RE-AUDITADA 14/07** (ver D-004-A1: vazamento revisado 371 docs / R$ 1.475.637) · **etapa 2 REESTRUTURADA de novo (Pedro 14/07): o D-004 foi FUNDIDO NESTE D-001** — escopo ampliado para serviço **+** NF-e importação **+** DIV, todos sob a mesma lógica de admissão (allowlist + anti-join chave+valor). Spec só após o Pedro fechar as 2 pendências do D-004-A1. · **Smoke test de maio (14/07): anti-join VALIDADO em produção** — 59 admitidos = exatamente o previsto, 0 dupla contagem. **MAS só 10 geraram rateio (R$ 6.362 = 3,7% dos R$ 171.281 previstos)** — o restante tem classe fora de `incluir_controle` e o motor os descarta sem persistir (armadilha 22). **Captura efetiva depende do D-008 (levantar/classificar as classes) ANTES do re-sync completo jan–jun.** · *(histórico: em 13/07 a etapa 2 fora dividida em D-004 → D-001 → D-001-A1, agora consolidada)* Neste card: **NÃO remover o descarte de Origem=Estoque sem anti-join** contra `desp_realizado_doc` como critério de admissão (armadilha 12); normalizar caixa/hífen da espécie (armadilha 15); exige ORIGEM **+** allowlist na MESMA mudança (funis dependentes, armadilha 16) · **Origem:** report v2.0, Seção 8.1

Serviços (NFCom, NF3E, CT-e de serviço, NFS-e) com `ModuloOrigem=Estoque` caem no vão entre as duas rotas: o DocFin descarta `Origem=Estoque` (anti-duplicação) e o MovEstq não os vê porque serviço não movimenta estoque. Caso comprovado: NF Telefônica/VIVO 2921888 (chave 26521), R$ 7.281,12, maio.

Sequência obrigatória (não pular etapas):

1. ⚠️ **Medir primeiro:** quantos docs DocFin com `Origem=Estoque` + espécie de serviço, por competência jan–jun, NÃO estão no MovEstq. Query de diagnóstico via MCP Supabase, sem escrita.
2. 🔧 Corrigir a rota `docfin-despesas` no **erp-proxy** (repo do proxy, não este): não descartar `Origem=Estoque` quando a espécie é de serviço. Cirúrgico — não reintroduzir duplicação de NFs de mercadoria.
3. 🔧 Re-sync jan–jun (seguro: unique `uq\_desp\_rateio\_grao` impede duplicação por construção).
4. 🔧 Reconciliar contra o razão de maio e registrar resultado aqui.

**Resultado da etapa 1 — medição CONCLUÍDA (13/07/2026):**

Fonte definitiva: **censo `/docfin-despesas/censo` jan–jun** (erp-proxy, leitura pura — 2.384 docs descartados / R$ 15,42M), cruzado por identidade (`especie` + `codigo_entidade` + `ltrim(numero-base,'0')`) contra `desp_realizado_doc` **all-dates** e `desp_docfin_doc`.

* **Vazamento real: 391 docs / R$ 2.124.570** (14% do descartado). O resto — 1.993 docs / R$ 13,30M — é **descarte legítimo** (o doc está no MovEstq, ou é FAT/PROV/CAR/CART por classificação do Pedro).
* Por destino: **serviço 148 docs / R$ 727.537** (este card) · mercadoria NF-e 211 / R$ 1.208.312 (**D-001-A1**) · DIV 25 / R$ 156k · JUR/CF/ADT/CSRF 7 / R$ 33k.
* Por funil: ORIGEM 371 docs / R$ 1,44M · ESPÉCIE 20 docs / R$ 0,69M (13 NF-e Origem≠Estoque R$ 653k + JUR/CF/ADT/CSRF).
* **Achado que muda a etapa 2:** NFS-e/CT-e/NF3E têm `na_allowlist=false` → bloqueados pelos **dois** funis. O passo 2 abaixo (só relaxar ORIGEM) recupera **R$ 0** desses — só NFCom (allowlist=true, R$ 38,7k). Recuperar serviço exige ORIGEM **+** allowlist juntos (ver armadilha 16).
* Cobertura do Hub sobre o DocFin PAG jan–jun: **29,1% do valor** (R$ 6,33M de R$ 21,75M).
* ⚠️ Cruzar contra MovEstq de **todas as datas** (não só jan–jun): docs de competência 2026 podem ter sido capturados no MovEstq com competência 2025. Restringir a jan–jun triplica o falso-vazamento.
* *(Medição interina via `contas_pagar` — jan–mar, 55 serviço / 112 merc. — **superada** por esta: contas_pagar congelou em 08/04 e o match jan–jun-only superestimava.)*

### D-001-A1 — Ajuste do D-001: vazamento de mercadoria/imobilizado (Origem=Estoque)

**Status:** ⬜ ABSORVIDO no D-001 em 14/07/2026 (ver D-004-A1: a mercadoria NF-e passou a ser tratada junto com serviço e NF-e importação, mesma lógica de admissão). Card mantido pelo histórico da chave validada. · **Origem:** medição da etapa 1 do D-001 (13/07/2026) · ~~D-001 permanece restrito a serviço.~~ · Chave de casamento (`especie`+`entidade`+`ltrim(numero-base)`) validada empiricamente no censo — **taxa de match 82,3% (1.729/2.100), 0 colisões, valor confere em 98,67% dos matches; 23 FP potenciais (1,3%)** → anti-join = chave **+** tolerância de valor (armadilha 18). Executa só após D-001 validado.

A etapa 1 revelou um segundo sabor do vazamento, não previsto no report: docs de **mercadoria/imobilizado** com Origem=Estoque que não geraram movimento no MovEstq — censo jan–jun: **NF-e 211 docs / R$ 1.208.312** (Estoque 198 / R$ 555k + Origem≠Estoque, os "13 NF-e", 13 / R$ 653k) + **DIV 25 / R$ 156k** (ex.: KABUM, SCANSOURCE, MARELLI, SOLIDSTEEL, MAGAZINE LUIZA). Provável imobilizado/consumo direto que não passa pelo estoque. FAT foi reclassificada como descarte legítimo (decisão do Pedro), fora deste card. NF-e (Estoque) também tem `allowlist=false` → a correção precisa de ORIGEM **+** allowlist juntos, como no D-001.

Sequência obrigatória (não pular etapas):

1. ⚠️ **Validar a confiabilidade da chave de casamento DocFin↔MovEstq** (`split_part(numero,'/',1)` + `codigo_entidade` + espécie) ANTES de qualquer anti-join — medir falso-positivo/negativo por amostra manual + reconciliação de contagens. Só seguir se a chave for confiável.
2. 🔧 Só então dimensionar e propor a correção de mercadoria/imobilizado (não descartar Origem=Estoque para essas espécies, ou investigar por que não geraram MovEstq). Cirúrgico, sem reintroduzir duplicação de NF de mercadoria já capturada.
3. 🔧 Decidir com o Pedro se imobilizado entra em despesa realizada ou é tratado à parte.

### D-002 — Fase 1 / Padrão 2: investigar os 4 CT-e J.V. Brito

**Status:** ⬜ não iniciado · **Origem:** report v2.0, Seção 8.2

CT-e 166192, 166377, 166386, 166536 estão no razão de maio mas ausentes das duas fontes, embora CT-e vizinhos tenham sido capturados. Ação: Pedro abre um deles na tela do Alvo (módulo, status, movimento de estoque) → só então decidir se é corrigível. Verificar também a NF 4699 Guilherme Agreli (R$ 5.000, lançamento atípico).

### D-003 — Operação: desempates 1:N + 14.10 (trabalho do Pedro, pela tela)

**Status:** ⬜ em aberto · **Não é trabalho do agente** — registrado para acompanhamento.

Ordem sugerida: 22.04 Seguros (R$ 109) como teste ponta a ponta → depois as materiais (25.02 R$ 359k, 17.02 R$ 198k, 19.05 R$ 149k). A 17.01 depende de confirmar como o Alvo lança na prática (amortização + juros ou conta única). Quando concluído, o agente atualiza a cobertura do carimbo na Seção 1.

### D-004 — Correção Fase 1 (a): 13 NF-e Origem≠Estoque fora da allowlist (R$ 653k)

**Status:** ❌ PREMISSA INVALIDADA 14/07/2026 — **superado pelo D-004-A1.** A premissa "sem risco de duplicação" caiu no anti-join real: 11 dos 13 já estão no MovEstq. Card mantido intacto (regra 0.4); a decisão e os números corretos vivem no D-004-A1. · **Origem:** reestruturação da correção (Pedro, 13/07/2026) · ~~PRIMEIRO da sequência de correção — sem risco de duplicação.~~

Os 13 NF-e descartados pelo **funil ESPÉCIE** com Origem≠Estoque (12 Vendas + 1 Nenhum) — R$ 653.224 — são vazamento confirmado: não estão no MovEstq (por serem Origem≠Estoque, o MovEstq nem os vê) e o funil ESPÉCIE os barra por estarem fora da allowlist. Corrigir **primeiro** porque **não mexe no descarte de Origem=Estoque** → zero risco de duplicação (não precisa de anti-join). Cirúrgico e isolado.

Sequência:

1. 🔧 Spec da mudança na allowlist do funil ESPÉCIE (erp-proxy) — habilita esses NF-e Origem≠Estoque; **não toca** no funil ORIGEM.
2. 🔧 Re-sync jan–jun e reconciliar (esperado: +13 docs / +R$ 653k).

### D-004-A1 — Ajuste do D-004: fusão no D-001 + re-auditoria da etapa 1 inteira

**Status:** ✅ re-auditoria CONCLUÍDA 14/07/2026 · **Origem:** achado ao tirar o snapshot baseline do D-004 (Pedro, 14/07) · **Decisões do Pedro (14/07):** (1) recorte **(b)** — D-004 **fundido no D-001**; NF-e de importação e serviço têm a MESMA lógica de admissão (allowlist + anti-join chave+valor+tolerância) → uma correção só, o D-004 isolado deixa de existir; (2) re-auditar a etapa 1 inteira tratando o número anterior como suspeito; (3) este card. **Artefatos:** `snapshot-despesas-pre-D004.json` (baseline pré-re-sync), `reauditoria-etapa1.json` (quadro consolidado), `scratchpad/reauditoria.py` (método reproduzível).

**O achado (o que invalidou o D-004).** O D-004 assumia que os 13 "NF-e Origem≠Estoque" eram vazamento 100% seguro ("Origem≠Estoque ⇒ MovEstq não os vê ⇒ zero dupla contagem"). Anti-join real por chave+valor contra `desp_realizado_doc` all-dates: **11 dos 13 já estão no MovEstq e já contam na despesa realizada** (valor batendo ao centavo, 10 deles com `origem`=Estoque no MovEstq). São NF-e de **importação** (BALLY, MICROLUMEN, ZEUS, QOSINA…): o DocFin marca módulo "Vendas", a entrada gera MovEstq "Estoque". Raiz na **armadilha 19**. Só **2 dos 13** são vazamento genuíno (ausentes das duas rotas): Shanghai Eco Polymer `4562` R$ 28.710,01 (abr) + TAIWAN YUN LIN `4803` R$ 11.743,46 (jun) = **R$ 40.453,47**. Dupla contagem evitada: **R$ 612.770,92**.

**Re-auditoria da etapa 1 (anti-join real, all-dates, chave+valor, TODO o funil ORIGEM + TODO o ESPÉCIE):**

|Categoria|docs|valor|
|-|-|-|
|Total descartado (censo jan–jun)|2.384|R$ 15.422.358|
|LEGÍTIMO — já no MovEstq (chave+valor)|1.905|R$ 11.903.578|
|LEGÍTIMO — descarte por natureza (FAT 53, PROV 12, CAR 17, CART 2, +JUR/CF/ADT/CSRF)|91|R$ 1.921.919|
|REVISÃO — match por chave, valor diverge >R$50 (14 CT-e ent 0000132: MovEstq>DocFin; já no MovEstq)|17|R$ 121.225|
|**VAZAMENTO REAL**|**371**|**R$ 1.475.637**|

Vazamento real detalhado: **serviço 148 / R$ 727.536** (NFS-e 111/R$668.737 · NFCom 7/R$38.711 · CT-e 28/R$18.495 · NF3E 2/R$1.594) — **idêntico à etapa 1, essa parte estava certa** · **mercadoria NF-e 198 / R$ 592.155** · **DIV 25 / R$ 155.945**. Por funil: ORIGEM 369/R$1.435.183 · ESPÉCIE 2/R$40.453.

**O que mudou vs etapa 1 (391 docs / R$ 2.124.570 → 371 docs / R$ 1.475.637 = −20 docs / −R$ 648.933):** (a) os 13 NF-e ESPÉCIE → 2 vazamento + 11 já capturados (−R$ 612.771, causa = armadilha 19); (b) os 7 JUR/CF/ADT/CSRF saíram de vazamento para descarte-por-natureza (−R$ 33k).

**Pendências — RESOLVIDAS pelo Pedro (14/07):**
1. ✅ **JUR/CF/ADT/CSRF (7 docs / R$ 33k) ficam FORA do D-001.** Decisão do Pedro: **não adicionar espécie à allowlist por suposição sobre o que ela significa** (foi essa dedução que custou os R$ 612k). Viram o card **D-005** (pendência aberta — Pedro abre na tela do Alvo e classifica). O D-001 **não** é travado por isso.
2. ✅ **17 docs de "revisão" (R$ 121k) ficam FORA do vazamento** — o doc está capturado, a chave bate. Nesses CT-e (14 da transportadora ent 0000132) o **frete provavelmente compõe o custo da mercadoria no MovEstq** e por isso não aparece como linha de despesa própria — **relevante para o orçamento por setor da Fase 2** (Backlog).

**Colisões de chave — investigadas (14/07):** re-auditoria achou **4 colisões em 5.117 chaves** (0,08%), contra 0 na validação de 13/07. **Não é contradição:** a de 13/07 rodou só sobre NF-e (contexto D-001-A1) e lá não há colisão; hoje o escopo é todas as espécies, e as 4 estão em **FAT (3) e DIV (1)** — nenhuma em NF-e/serviço. **Candidatos a admissão com chave colidida: 0.** 3 são FAT (nunca admitida); a 1 DIV (`10117` × `10117/A`, colisão criada pelo `split_part(numero,'/',1)`) tem seu único descartado casando PRESENTE. Risco de admissão errada hoje = nulo; ainda assim a spec do D-001 leva **guarda de colisão** (chave colidida → nunca admitir, vai a revisão) por robustez futura (armadilha 18).

**Consequência para o D-001 (escopo ampliado):** o D-001 passa a cobrir serviço **+** NF-e de importação **+** DIV, todos sob a MESMA lógica de admissão: relaxar ORIGEM **e** incluir espécie na allowlist (armadilha 16), **condicionado ao anti-join chave+valor+tolerância contra `desp_realizado_doc` all-dates** como critério de admissão (armadilhas 17, 18, 19, 20). Pendências fechadas → **spec do D-001 escrita 14/07** (ver `SPEC-D001-erp-proxy.md`). Delta seguro esperado do re-sync: **+371 docs / +R$ 1.475.637** (só os que falham o anti-join).

### D-005 — Espécies não classificadas: JUR/CF/ADT/CSRF (7 docs / R$ 33k)

**Status:** ⬜ PENDÊNCIA ABERTA (trabalho do Pedro, pela tela) · **Origem:** re-auditoria do D-004-A1 (14/07/2026). · **Não trava o D-001.**

Sete docs do funil ESPÉCIE, ausentes do MovEstq, que **não** entram no D-001 porque adicionar a espécie à allowlist exigiria supor o que ela significa — a dedução proibida (armadilha 20). O Pedro abre cada um na tela do Alvo e classifica (despesa a capturar × fora de perímetro):

|Espécie|Entidade|Valor|Nota|
|-|-|-|-|
|JUR|0000145|R$ 30.335,98|juros — provável despesa financeira real; **91% do card**|
|CF|0001476|R$ 657,01| |
|CF|0001099|R$ 344,98| |
|CF|0000523|R$ 147,00| |
|CF|0000523|R$ 66,90| |
|ADT|0001629|R$ 840,00|adiantamento?|
|CSRF|0000033|R$ 384,80|retenção?|

Quando o Pedro classificar, o que for despesa entra pela mesma lógica do D-001 (allowlist + anti-join); o que for fora de perímetro vira descarte por natureza documentado.

### D-006 — Bug de duplicação intra-rodada de rateios em RDESP/PC (erp-proxy)

**Status:** ✅ limpeza + UNIQUE **EXECUTADOS 14/07/2026** (aprovação do Pedro; cron pausado durante a operação e reativado). **Passo 3 (upsert no proxy) PENDENTE, não-urgente** — o UNIQUE já mata a corrupção. · **Origem:** achado ao verificar a idempotência do backfill do D-001. · Não bloqueou o D-001.

**Resultado real (14/07):** PRÉ 181 linhas / R$ 1.174.750,31 → PÓS 165 linhas / R$ 1.152.546,84 · DELETE 16 (9 docs) · **delta R$ 22.203,47 — bateu ao centavo com o previsto**. `uq_desp_docfin_rateio_grao` criada. Como o `ALTER ADD UNIQUE` valida a tabela INTEIRA e passou, ficou **provado que abril era a única competência com duplicação** (conferido também: 0 grãos duplicados na tabela toda pós-limpeza).

**Escopo exato (dry-run 14/07):** duplicação = grão `(chave_docfin, ordem_classe, ordem_rateio)` com count>1. **Toda a tabela: 9 grãos / 16 linhas extras, 100% em abril/2026** (8 RDESP ent 0000934 + 1 PC 26217 ent 0001669). Inflação **R$ 22.203,47**, dominada pelo PC 26217 (R$ 22.000). Pós-limpeza: rateio abril 1.174.750,31 → 1.152.546,84 ≈ doc 1.152.847,29 (alinha ao padrão das outras competências). Abril está ABERTA.

**Diagnóstico de causa raiz (14/07):** **concorrência sem atomicidade no delete→insert, disparada por enfileiramento múltiplo do mesmo `chave_docfin` na rodada de captura.** Evidências: (a) cópias são do MESMO grão único (ordem 1,1), idênticas; (b) spread temporal 16–189ms entre cópias → operações assíncronas (workers concorrentes), não loop síncrono; (c) nº de cópias (2–3) NÃO correlaciona com parcelas (todos os 9 têm 1 parcela no payload) nem com numero compartilhado (docs de numero único também duplicaram) → refuta "explosão por parcela"; (d) só na 1ª rodada de abril (02/06 12:32), `sync_em` congelado → duplicata órfã que o delete→insert posterior não tocou (docs não re-listados). Mecanismo: doc entra 2–3× na fila da rodada (provável **paginação por offset com ordenação instável** — RDESP/PC são despesa avulsa lançada em lote na mesma data, ex. 4× "09042026", que empata a ordenação e concentra boundaries), N workers processam o mesmo `chave_docfin` em paralelo, cada um `DELETE where chave=X` (todos veem ~vazio) e depois `INSERT` → N cópias. **Ressalva:** o campo de ordenação e a ausência de lock por chave só se confirmam no código do proxy (regra 11 — não leio); com N=9 não afirmo exclusividade de RDESP/PC por design, apenas concentração da condição. A correção estrutural (UNIQUE) elimina a classe do bug independente da causa exata do enfileiramento.

Sequência:
1. ✅ **Limpeza dos 16 grãos extras de abril** (14/07) — DELETE mantendo a linha mais antiga por grão, WHERE `ano=2026 and mes=4`. Removidas 16 linhas / R$ 22.203,47.
2. ✅ **UNIQUE estrutural** `uq_desp_docfin_rateio_grao (codigo_empresa_filial, chave_docfin, ordem_classe, ordem_rateio)` criada (14/07) — espelho do `uq_desp_rateio_grao` do MovEstq. O 2º INSERT da race agora falha em vez de corromper.
3. ⬜ **Passo 3 (não-urgente) — spec ao proxy** (erp-proxy, Pedro implementa): migrar o INSERT dos rateios para `INSERT ... ON CONFLICT (grão) DO UPDATE` (upsert), tornando o delete→insert idempotente e concorrência-safe (elimina até o erro que o UNIQUE agora dispara na race). Idealmente estabilizar a ordenação da paginação para não enfileirar o mesmo doc 2-3×. O agente escreve a spec quando o Pedro priorizar.

### D-007 — Resíduo R$ 300,45: rateio de abril < valor dos docs (não-bloqueante)

**Status:** ⬜ pendência aberta, não-bloqueante · **Origem:** limpeza do D-006 (14/07/2026).

Após a limpeza do D-006, o rateio de abril (**R$ 1.152.546,84**) ficou R$ 300,45 **abaixo** do valor dos docs de abril (**R$ 1.152.847,29**). **Não vem do D-006** (o D-006 removeu inflação; este é um *déficit*). Provável classe fora do controle (doc sem rateio gravado por não ter conta mapeada) ou arredondamento de rateio percentual. Registrado para não renascer como investigação do zero. Ação futura: localizar o(s) doc(s) de abril com `sum(rateio) < valor_documento` e classificar. Verificar se o mesmo padrão existe nas outras competências (as diferenças pequenas rateio×doc vistas no baseline sugerem que sim, e são benignas).

### D-008 — Levantar as classes dos 371 do vazamento (pré-requisito da classificação)

**Status:** ✅ resolvido pela **via (b)** (Pedro escolheu 14/07) → spec entregue em `SPEC-D010-persistir-nao-controlados.md`, implementação no card **D-010**. A via (a) censo-one-shot foi descartada: sem (b), toda competência futura repete a cegueira. · **Origem:** smoke test de maio (14/07/2026).

O smoke test de maio provou que **as classes dos 371 docs do vazamento NÃO estão no banco**: o motor descarta o doc inteiro quando a classe não está em `incluir_controle` (não persiste). Confirmado: dos docs de espécie-alvo de maio, só os 9 com classe já controlada (14.04, 09.04, 25.02) sobraram; os 49 sem classe controlada sumiram sem rastro. Logo a lista que o Pedro vai classificar na tela precisa ser obtida via **Load** (não RetrievePage — o censo atual não traz classe). Duas vias:

* **(a) Rota "censo-com-classe" no erp-proxy** (spec do agente, Pedro implementa): Load individual dos docs do vazamento jan–jun (identificados pelo censo + anti-join), agregando **por classe** (código, nome, contagem de docs, valor total, `incluir_controle` atual), **sem gravar**. Leitura pura. Entrega a lista ordenada por valor para classificação. Via rápida.
* **(b) Mudança de design no motor** (estrutural): persistir os docs admitidos **mesmo com classe fora de controle**, marcando `classificacao='NAO_CONTROLADA'` (rateio pendente) → o Pedro vê o universo real na própria tela e classifica; um recarimbo ativa. Elimina a cegueira permanentemente (o motor deixa de descartar despesa real sem deixar rastro).

Recomendação: **(a) para a lista imediata; (b) como correção estrutural** (senão, toda competência futura repete a cegueira). Agente escreve a spec quando o Pedro escolher a via.

### D-009 — Órfãos de captura antiga em `desp_docfin_doc` (48 docs de maio)

**Status:** ⬜ investigado 14/07/2026, decisão pendente · **Origem:** trava de órfãos do smoke test de maio. · Não-urgente.

48 docs de maio (**41 RDESP + 6 PC + 1 DIV**) com `sync_em` de **junho** (02–24/06, versão anterior do código), Tipo=PAG, `codigo_situacao` 02.x (normal do DocFin — não é anomalia), `origem_alvo`=null, **todos com rateio** (contam **R$ 12.387,40** na despesa de maio hoje). O reprocessamento atual (14/07) não os re-listou → a trava de órfãos os identificou e **não apagou (correto)**. Breakdown:

* **21 docs / R$ 239,60** têm gêmeo recém-capturado de mesmo valor → provável **duplicata** (mas micro-valor; `numero`=data em RDESP pode gerar falso-positivo).
* **27 docs / R$ 12.147,80** sem gêmeo → docs distintos que a versão atual não re-lista (inclui DIV R$ 5.773,30 de 27/05 e PC "SANTANDER-PF" R$ 4.966,33 — parecem pagamentos reais).

**Recomendação: NÃO remover agora** (Pedro concordou 14/07). Decidir a política de órfãos junto com o go-live do D-001: entender **por que a lógica atual não os re-lista** (se é filtro correto → saem; se é falha de listagem/paginação → o motor corrige). Remover no escuro o bloco sem gêmeo subestimaria a despesa. A trava não-apagar é o comportamento certo. · **Nota do Pedro (14/07):** RDESP e PC são **exatamente as espécies do bug D-006** (duplicação intra-rodada) — provavelmente não é coincidência; a mesma fragilidade de paginação/concorrência que duplica pode ser a que deixa órfãos. Card fica **aberto para depois do go-live**.

### D-010 — Persistir despesa de classe não-controlada (visível, fora do total)

**Status:** ⬜ spec entregue 14/07/2026 (`SPEC-D010-persistir-nao-controlados.md`), implementação aguardando priorização do Pedro. · **Origem:** via (b) do D-008. · **Buraco estrutural de controle** — não é só do D-001: hoje o Hub descarta despesa de classe não-controlada em qualquer espécie, sem deixar rastro.

**Requisito inegociável:** persistir ≠ contar. Rateio de classe não-controlada é gravado **visível e auditável**, mas **fora de todo `sum(valor_brl)` por padrão**. Fonte única da verdade = `desp_classe_config.incluir_controle` (default `false`); o total nunca inclui classe fora de controle, mesmo com flag divergente (defesa em profundidade).

**Cadeia de agregação mapeada (14/07, verificada no banco + `src/`):** só a view `v_despesa_realizada_unificada_base` (`sum(valor_brl)`) → RPC `listar_despesa_realizada_unificada` (`soma_brl`) → tela `RealizadoDespesas.tsx` somam. `get_despesa_realizada_rateios` só detalha; `desp_recarimbar` só escreve `conta_hierarquica`. Nenhum outro consumidor.

Etapas (ordem obrigatória 2→4 para nunca haver janela de inflação): (1) schema — coluna `em_controle` em `desp_docfin_rateio`+`desp_realizado_rateio` (**default `false`** — o esquecimento do proxy erra para o lado seguro; backfill seta `true` explícito nas linhas existentes) + trigger que sincroniza com `incluir_controle` pulando meses FECHADOS; (2) view+RPCs filtram por `em_controle`+`incluir_controle`, expõem `valor_fora_controle`; (3) front — indicador "fora do controle" + aba "A Classificar" em `/despesas/config-contas` (absorve o D-008); (4) proxy — "persistir sempre" + `em_controle` snapshot + upsert (junto com o passo 3 do D-006). Detalhes na spec.

*(novos cards entram aqui: D-011, D-012, ...)*

\---

## 3\. Backlog — Fase 2 (não iniciar sem card)

* Telas por setor (de-para CC → Setor pronto, Seção 4 do report).
* Conciliação automática mensal razão × captura (metodologia validada: FI por número+fornecedor; FP/IP por conta contábil; CB fora do perímetro).
* Orçamento por setor (objetivo final). **Nota (14/07):** em CT-e de transporte vinculados a compra (ex.: transportadora ent 0000132), o **frete compõe o custo da mercadoria no MovEstq** e não aparece como linha de despesa própria — o valor no MovEstq fica maior que o do DocFin (14 casos, os "17 de revisão" do D-004-A1). Ao ratear despesa por setor, não dá para tratar esse frete como despesa autônoma sob risco de dupla contagem contra o custo da mercadoria.
* Rateio de pessoal por setor de destino (precisa base de headcount; hoje Administrativo = 62,8% por concentrar folha).
* Higiene: 6 dias `FALHA\_PERMANENTE` em 2025; contadores de `desp\_docfin\_competencias` só guardam última execução.
* Higiene (14/07/2026): **`sync-compras-status-cron` tem `paused_at`=26/05/2026 órfão** (`enabled=true`, mas `paused_at` preenchido — foi pausado e reativado sem limpar o campo). Cosmético, não afeta operação. Limpar: `update sync_settings set paused_at=null where job_name='sync-compras-status-cron';` (armadilha 21).

\---

## 4\. Regras invioláveis e armadilhas (NÃO reescrever — só adicionar)

1. **`--no-verify-jwt` é OBRIGATÓRIO** ao redeployar qualquer Edge Function de sync:

```powershell
   supabase functions deploy sync-despesas-cron --project-ref hbtggrbauguukewiknew --no-verify-jwt
   ```

   Sem a flag, o cron falha silenciosamente com `401 UNAUTHORIZED\_NO\_AUTH\_HEADER`.

2. **RLS sem policy = leitura vazia silenciosa.** Tabelas `desp\_\*` têm RLS ativo e zero policies. Frontend sempre via RPC `SECURITY DEFINER`, nunca `.from()` direto.
3. **Balancete ≠ plano de contas.** Dropdowns e de-paras usam o "Plano de Contas Específico sem Saldo" (cadastral), nunca o balancete.
4. **De-para exige conta de RESULTADO** (`5.x`/`4.x`). Conta de balanço (`1.x`/`2.x`) faz a conciliação nunca fechar.
5. **Mês FECHADO é imutável** — trigger `desp\_bloqueia\_rateio\_fechado` vale para RPC, SQL Editor, qualquer caminho.
6. **Regras do Alvo:** filial 1.01 · `Tipo='PAG'` · `Projecao='Não'` · `Competencia` normalizada ao dia 1º · classe+CC só no `Load` individual (nunca `RetrievePage`) · `RetrievePage` só via gateway · `UserConta\_Contab` é obsoleto, não usar.
7. **SQL Editor corta em 100 linhas** — usar Export CSV ou paginar.
8. **Disparo manual de crons:** não existe `CRON\_SECRET` local. Usar o SQL Editor:

```sql
   SELECT public.call\_sync\_despesas\_cron('manual\_admin');  -- MovEstq
   SELECT public.call\_sync\_docfin\_cron('manual\_admin');    -- DocFin
   SELECT id, status\_code, content::text, created FROM net.\_http\_response ORDER BY created DESC LIMIT 3;
   ```

9. **Visual institucional:** Light + Dark perfeitos, sem glow/glassmorphism/gradientes, `tabular-nums`, cor forte só para exceções.
10. **Fluxo de alteração de código (adicionada 13/07/2026):**

    * **Frontend/serviços:** o agente altera os arquivos **localmente** no repo e o Pedro aprova o `git push` — o Lovable sincroniza via GitHub. Este é o ÚNICO caminho de escrita de código.
    * **Edge Functions:** não passam pelo Lovable. Deploy exclusivamente via Supabase CLI no PowerShell, sempre com `--no-verify-jwt` (Regra 1).
    * **MCP do Lovable:** somente com autorização explícita do Pedro, e somente quando ele pedir. Uso permitido: leitura/consulta (status, logs, preview).
    * **PROIBIDO:** enviar mensagem/prompt ao Lovable para que a IA dele altere arquivos. Nunca, em nenhuma circunstância — nem como fallback, nem "para agilizar". Alteração de código é sempre local + git.
11. **Dois repos — o agente só toca um (adicionada 13/07/2026).** O `erp-proxy` é código do Pedro, deploy **manual** no Render. **O agente nunca o toca — nem lê o repo, nem escreve código, nem deploya.** Para mudanças no proxy (rota/mapper/PDF/sync/descarte), o agente entrega **especificação funcional**; o Pedro implementa e publica.
12. **Anti-duplicação MovEstq↔DocFin é lógica de rota, não constraint (adicionada 13/07/2026).** Os uniques (`uq_desp_rateio_grao` etc.) protegem **dentro** de cada tabela, não **entre** as duas rotas. A não-duplicação depende do descarte de Origem=Estoque na rota `docfin-despesas`; se essa lógica falhar ou mudar, nada no banco impede o mesmo doc entrar pelas duas rotas.
13. **Medir vazamento Origem=Estoque exige fonte externa às tabelas do módulo (adicionada 13/07/2026).** `desp_docfin_doc` descarta Origem=Estoque antes de persistir. A única fonte no Supabase que os retém é `contas_pagar` (legado, **congelada em 08/04/2026**, sem mai–jun) — proxy não-autoritativo até ~março. Medição completa/atual exige o Alvo via rota de censo no gateway.
14. **Netting obrigatório: MovEstq captura serviço (adicionada 13/07/2026).** `desp_realizado_doc` tem NFS-e/CT-e/NFCom quando o Alvo amarra a nota a um movimento. Cruzar por identidade exige `split_part(numero,'/',1)` — o número do DocFin/`contas_pagar` tem sufixo `/parcela-total`, o MovEstq guarda limpo. `chave_movestq` em `contas_pagar` é ~sempre null: não serve de chave.
15. **Espécies do Alvo vêm com CAIXA inconsistente (adicionada 13/07/2026).** O mesmo tipo aparece como `CT-e`/`Ct-e` e `NF3E`/`NF3-e`. Allowlist e casamento por espécie DEVEM ser case-insensitive — senão a variante minúscula escapa dos dois lados. Ex.: o CT-e J.V. Brito **166192** (D-002) vem como `Ct-e`.
16. **Funis ORIGEM e ESPÉCIE são dependentes para serviço (adicionada 13/07/2026).** A captura DocFin só grava se o doc passa nos DOIS funis: Origem≠Estoque **e** espécie na allowlist. NFS-e/CT-e/NF3E (e NF-e) têm `allowlist=false` → remover só o funil ORIGEM recupera **R$ 0** deles (caem no funil ESPÉCIE). Recuperar serviço/mercadoria exige relaxar ORIGEM **e** incluir as espécies na allowlist, na MESMA correção. O censo expõe isso em `cenarios.bloqueados_pelos_dois`.
17. **Cruzar sempre contra o MovEstq de TODAS as datas (adicionada 13/07/2026).** Um doc de competência 2026 pode ter sido capturado no `desp_realizado_doc` com competência 2025 (backlog). Restringir o anti-join a jan–jun gera falso-vazamento em massa (no censo, ~3× mais). Identidade (espécie+entidade+número) é única no tempo → match all-dates é correto.
18. **Anti-join DocFin↔MovEstq: casar por chave E conferir valor (adicionada 13/07/2026).** A chave (`especie`+`codigo_entidade`+`ltrim(numero,'0')`) é injetora — validada: 0 colisões em 5,6k chaves, match 82,3%, valor confere em 98,67% dos matches. Mas ~1,3% dos matches têm valor divergente (quase sempre o mesmo doc com representação diferente — parcela/retenção/desconto — dado 0 colisões). Ao usar o anti-join como critério de admissão da correção, casar por chave **e** conferir valor com tolerância; os divergentes vão para revisão manual, **nunca dropados no escuro**. *(Reconfirmada na re-auditoria de 14/07: match 80,6%, 4 colisões em 5.117 chaves = 0,08%, 17 divergências >R$50 — 14 delas CT-e da transportadora ent 0000132, valor MovEstq > DocFin, mesmo doc.)* **Guarda de colisão (obrigatória em qualquer anti-join de admissão):** se a chave do doc candidato **colide** no MovEstq (aponta para ≥2 docs de valores distintos), **NÃO admitir automaticamente — mandar para revisão manual.** Colisão é o único vetor pelo qual o anti-join poderia admitir errado e gerar dupla contagem; na dúvida, dropar sempre vence admitir. As 4 colisões atuais são FAT/DIV (0 candidatos a admissão afetados), mas a guarda protege competências futuras. A colisão nasce do `split_part(numero,'/',1)` (ex.: `10117` e `10117/A` colapsam) — número-base não é único quando há sufixo alfanumérico após a barra.
19. **`origem_alvo` (DocFin) e `origem` (MovEstq) são campos de FONTES DIFERENTES e NÃO são comparáveis (adicionada 14/07/2026 — a mais cara do módulo até hoje).** Um mesmo documento físico chega ao DocFin com `origem_alvo` = módulo do lançamento financeiro (ex.: NF-e de importação vem como **"Vendas"**) e ao MovEstq com `origem` = origem do movimento de estoque (a mesma nota vem como **"Estoque"**). São dimensões distintas de sistemas distintos. **NENHUMA inferência sobre a presença de um doc na outra rota pode ser feita a partir de campo de origem.** A única prova de presença é o **anti-join real por chave + valor contra a rota destino** (armadilha 18). Toda a etapa 1 do D-001 foi construída sobre a dedução "Origem≠Estoque ⇒ ausente do MovEstq" e por isso foi re-auditada em 14/07 — 11 dos 13 "NF-e Origem≠Estoque" estavam, na verdade, já no MovEstq (dupla contagem de R$ 612.770,92 evitada). Ver D-004-A1.
20. **Dedução estrutural nunca substitui medição (adicionada 14/07/2026 — regra de método).** "Como X, logo Y" é hipótese, não evidência. **Antes de qualquer correção que relaxe um descarte, o anti-join contra a rota destino é OBRIGATÓRIO**, mesmo quando a premissa parecer óbvia — **inclusive quando quem afirma a premissa é o próprio agente ou o Pedro.** Convenção do módulo (Seção 0.5): nada vira ✅ sem query/response/execução. A armadilha 19 é o caso concreto que custou essa regra: a premissa parecia óbvia e estava errada em 85% dos docs.
21. **Kill-switch de cron em `sync_settings` (ferramenta operacional — adicionada 14/07/2026).** Os 7 crons de sync têm liga/desliga por linha em `public.sync_settings` (`job_name`), independente do agendamento pg_cron. `enabled=false` faz a Edge Function **pular sem processar** (ela checa antes de reabrir janela/gravar) — o pg_cron ainda dispara a Edge, mas ela retorna skip; **não grava nada.** Usar antes de operações de escrita/DDL na tabela de destino do cron (ex.: D-006). **Pausar:** `update sync_settings set enabled=false, paused_at=now(), paused_reason='...' where job_name='...';` **Reativar:** `update sync_settings set enabled=true, paused_at=null, paused_reason=null where job_name='...';` ⚠️ `paused_by` é **UUID** (não aceita texto — deixar null; o motivo vai em `paused_reason`). ⚠️ Escrita em `sync_settings` exige MCP com `read_only=false` **ou** SQL Editor (o MCP nasce read-only). **Conferência:** `select job_name, enabled, paused_at, paused_reason from sync_settings order by job_name;` Os 7 `job_name`: `sync-compras-status-cron`, `sync-despesas` (MovEstq), `sync-docfin-despesas`, `sync-intercompany`, `sync-lote-cron`, `sync-nfe`, `sync-produtos-cron`.
22. **Valor do vazamento ≠ valor da despesa (adicionada 14/07/2026 — dedução≠medição no ELO FINAL).** O vazamento medido (**R$ 1,48M / 371 docs**) é o valor dos **DOCUMENTOS no Alvo**, NÃO o que vira despesa no Hub. Só vira despesa a parte cujas classes estejam em `desp_classe_config.incluir_controle=true`. As 123 classes em controle foram configuradas sobre um universo que **nunca incluiu NF-e/NFS-e/CT-e** (o funil Origem sempre os descartou) → as classes desses docs **nunca foram avaliadas**. **Smoke test de maio (14/07) provou:** 59 admitidos, mas só **10 geraram rateio — R$ 6.362 de R$ 171.281 (3,7%)** — porque os 49 restantes têm classe fora de controle. **Pior, o motor DESCARTA o doc inteiro quando a classe não está em controle — não persiste nada** → o Pedro fica cego para quais classes avaliar. Regra: **nunca apresentar R$ 1,48M como "despesa a recuperar"**; o valor real só se conhece após listar as classes dos 371 (card D-008) e o Pedro decidir quais incluir. É a mesma armadilha 20 (dedução≠medição) aplicada ao último elo da cadeia.

\---

## 5\. Concluído (histórico)

* **10/07/2026 — Fase 0 concluída:** de-para contábil internalizado (`desp\_plano\_contas`, `desp\_classe\_conta`, `desp\_competencia\_status`, coluna `conta\_hierarquica` como carimbo/snapshot), 4 RPCs de escrita + 3 de leitura, trigger de trava testada, tela `/despesas/config-contas` no ar.
* **10/07/2026 — Bug estrutural do cron MovEstq corrigido:** auto-semeadura (Passo 0) em `sync-despesas-cron` — semeia até D-1, idempotente, best-effort, preserva `FALHA\_PERMANENTE`. Validado (execução 16281: `{"semeados":\["2026-07-09"],"rateios\_gravados":16,"erros":0}`).
* **09/07/2026 — v1.0 do report:** captura dual (MovEstq + DocFin) em produção, de-para CC→Setor 100% mapeado, base jan–jun R$ 18,84M.

\---

## 6\. Changelog deste arquivo

|Data|Alteração|Por|
|-|-|-|
|13/07/2026|Criação do documento vivo a partir do report v2.0|Pedro + Claude|
|13/07/2026|Regra 10 adicionada: fluxo de código (local + git), Edge via CLI, MCP Lovable só com autorização, prompt ao Lovable PROIBIDO|Pedro + Claude|
|13/07/2026|Regra 6 emendada: leitura (SELECT) livre sem pedir autorização; rito de aprovação mantido só para escrita/DDL|Pedro + Claude|
|13/07/2026|D-001 etapa 1 (medição jan–mar) registrada: serviço 55 docs/R$261,4k + mercadoria 112 docs/R$382,4k; criado card D-001-A1; armadilhas 11–14 adicionadas|Pedro + Claude|
|13/07/2026|Spec da rota de censo `/docfin-despesas/censo` entregue (erp-proxy, medição mai–jun)|Pedro + Claude|
|13/07/2026|D-001 etapa 1 FECHADA via censo jan–jun (cruzado all-dates): vazamento real 391 docs / R$ 2,12M (serviço 148/R$727,5k, NF-e 211/R$1,21M, DIV 25/R$156k, outros 7/R$33k); funis dependentes; Hub cobre 29,1% do DocFin; armadilhas 15–17|Pedro + Claude|
|13/07/2026|Chave de casamento validada empiricamente (match 82,3%, 0 colisões, valor confere 98,67%, 23 FP/1,3%); rodapé corrigido; armadilha 18 (anti-join = chave + valor); correção reestruturada em D-004 → D-001 → D-001-A1|Pedro + Claude|
|14/07/2026|**Premissa do D-004 invalidada** ao tirar o baseline: 11 dos 13 "NF-e Origem≠Estoque" já estavam no MovEstq (dupla contagem de R$ 612.770,92 evitada). D-004 fundido no D-001 (recorte b); criado D-004-A1; D-001-A1 absorvido|Pedro + Claude|
|14/07/2026|**Etapa 1 RE-AUDITADA** com anti-join real (all-dates, chave+valor) sobre todo o funil ORIGEM + ESPÉCIE: vazamento real revisado de 391/R$2,12M para **371 docs / R$ 1.475.637** (serviço 148/R$727,5k inalterado, NF-e 198/R$592,2k, DIV 25/R$155,9k); placar Seção 1 atualizado|Pedro + Claude|
|14/07/2026|Armadilhas 19 (`origem_alvo`≠`origem`: fontes diferentes, não comparáveis) e 20 (dedução nunca substitui medição; anti-join obrigatório) adicionadas|Pedro + Claude|
|14/07/2026|Pendências do D-004-A1 fechadas: JUR/CF/ADT/CSRF → card **D-005** (fora do D-001); 17 CT-e de revisão → fora do vazamento + nota de frete no Backlog Fase 2. 4 colisões investigadas (FAT/DIV, 0 candidatos afetados); guarda de colisão adicionada à armadilha 18|Pedro + Claude|
|14/07/2026|**Spec funcional do D-001 fundido entregue** (`SPEC-D001-erp-proxy.md`): allowlist ORIGEM+ESPÉCIE + anti-join chave+valor+guarda-de-colisão como critério de admissão; delta esperado +371 docs / +R$ 1.475.637 por competência|Pedro + Claude|
|14/07/2026|Idempotência do backfill DocFin **comprovada empiricamente** (mai/jun reprocessadas 33×/30× com razão rateio/valor=1.0; rateios recriados a cada espelho → delete→insert confirmado). Achado colateral: bug de duplicação intra-rodada em RDESP/PC (8 docs abril, ~R$22,3k) → criado card **D-006**|Pedro + Claude|
|14/07/2026|**D-006 executado e fechado** (limpeza 16 grãos / R$ 22.203,47 + `uq_desp_docfin_rateio_grao`); delta bateu ao centavo; ALTER na tabela inteira provou que abril era a única com duplicação. Diagnóstico de causa raiz: concorrência sem atomicidade no delete→insert + enfileiramento múltiplo (paginação). Passo 3 (upsert no proxy) fica pendente não-urgente|Pedro + Claude|
|14/07/2026|Card **D-007** (resíduo R$ 300,45 rateio<doc em abril, não-bloqueante); **armadilha 21** (kill-switch de cron em `sync_settings` — mecânica + query); higiene do `paused_at` órfão de `sync-compras-status-cron`|Pedro + Claude|
|14/07/2026|**Smoke test de maio** (Pedro): anti-join validado (59 admitidos=previsto), mas só 10 rateios (R$6.362/3,7%) — classes fora de controle e motor descarta sem persistir. **Armadilha 22** (valor vazamento≠despesa); cards **D-008** (censo-com-classe p/ levantar as classes dos 371) e **D-009** (48 órfãos de captura antiga)|Pedro + Claude|
|14/07/2026|D-008 resolvido pela **via (b)** (Pedro): **spec D-010** entregue (`SPEC-D010`) — persistir classe não-controlada visível mas fora do total; fonte única `incluir_controle`; cadeia de agregação (`v_despesa_realizada_unificada_base`→`listar_despesa_realizada_unificada`→tela) mapeada. D-009: nota que RDESP/PC = espécies do D-006|Pedro + Claude|

\---

## 7\. Referências rápidas

**Arquitetura:** Lovable (browser, JWT) e pg\_cron → Edge Functions (Deno, `X-System-Secret`) → erp-proxy (Render, riosoft-token cache 25min) → Alvo ERP (`pef.it4you.inf.br/api`, filial 1.01).

**Supabase:** projeto `hbtggrbauguukewiknew` · **Repo:** GitHub `financeiropfbrazil/finances-pf` (auto-deploy Lovable; Edge Functions via Supabase CLI).

**Tabelas:** `desp\_docfin\_doc/rateio` · `desp\_realizado\_doc/rateio` · `desp\_docfin\_competencias` · `desp\_dias\_capturados` · `desp\_classe\_config` (267 classes, 123 em controle) · `desp\_plano\_contas` · `desp\_classe\_conta` · `desp\_competencia\_status`.

**RPCs:** `desp\_set\_conta\_classe` · `desp\_recarimbar` · `desp\_fechar\_competencia` · `desp\_reabrir\_competencia` · `desp\_listar\_depara` · `desp\_listar\_plano\_resultado` · `desp\_listar\_competencias`.

**Arquivos-fonte:** frontend `src/pages/despesas/ConfigContasDespesas.tsx`, `src/services/deparaContabilService.ts`, `src/components/AppSidebar.tsx` · Edge `supabase/functions/sync-despesas-cron/index.ts`, `sync-docfin-cron`.





Dois repos, um módulo. finances-pf = frontend Lovable + Edge Functions (deploy: git push → Lovable; CLI → Supabase). erp-proxy = gateway do Alvo, onde vivem RetrievePage, autenticação riosoft-token e a lógica de descarte Origem=Estoque (deploy: manual no Render, pelo Pedro — **o agente nunca toca o erp-proxy: nem lê o repo, nem escreve código, nem deploya; só entrega especificação funcional**, conforme armadilha 11). Toda correção de captura (D-001, D-001-A1) é código do erp-proxy, não do finances-pf.

