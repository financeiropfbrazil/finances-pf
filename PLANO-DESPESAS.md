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

## 1\. Estado atual (snapshot: 15/07/2026)

**Em produção:**

* `/despesas/realizado` — visão unificada MovEstq + DocFin (jan/2026 em diante; bônus: R$ 11,2M de 2025 já capturados).
* `/despesas/config-contas` — de-para contábil + fechamento de competências (admin-only).

**Placar:**

|Item|Status|
|-|-|
|Total de despesa no Hub (todas as competências)|✅ **R$ 32.058.639,92** *(20/07, pós-reprocessamento de junho pelo D-001; era R$ 32.074.526,98)* · `valor_fora_controle` = **R$ 0,00** (invariante do D-010)|
|**D-001 em produção — 1ª rodada real (junho, 20/07)**|✅ o cron das **15:11** (tentativa 34) reprocessou junho com o código novo e **admitiu espécies-alvo pela 1ª vez**: NF-e **29434** ACURATE (R$ 103.344,87) · CT-e **29433/29432** TRANSCOURIER · NFS-e **29078** · NFCom **29057**. Junho: 243 → **238 docs**, R$ 1.434.526,06 → **R$ 1.418.639,00** (**−5 docs / −R$ 15.887,06 líquido** = entradas novas − órfãos/dupla contagem removidos). Decomposição nas 3 parcelas → **D-015**|
|Esterilização (D-011)|✅ **MEDIDA e RESOLVIDA para captura futura (20/07):** 20.02 = R$ 163.839,39/ano invisíveis (92,1%), agora com de-para `5.3.01.005.009` e `incluir_controle=true`. Histórico exige re-sync do MovEstq → **D-014**|
|Composição 2026|MovEstq R$ 13,65M (2.108 linhas) · DocFin R$ 7,21M (1.030 linhas). 2025: R$ 11,21M (só MovEstq). 2024: R$ 10,2k|
|Anti-join D-001 (proxy)|✅ **EM PRODUÇÃO** desde 14/07 — validado no smoke de maio: 59 admitidos = exatamente o previsto, 0 dupla contagem, índice MovEstq 5.122 linhas (paginado). **Conversão em despesa RE-MEDIDA 20/07: R$ 588,69 (não R$ 6.362) — ver D-012 e armadilha 26**|
|Backfill do D-001 — **ESCOPO REDUZIDO a jan–abr** (20/07)|⬜ **4 competências, não 6.** **mai, jun e jul já foram reprocessadas pela janela rolante com o código novo** (mai 20/07 · jun 20/07 15:11 · jul 14/07) — saíram do backfill sozinhas. Sobram **jan, fev, mar, abr**, que estão fora da janela e guardam a captura de 02/07 (código antigo). Fatiamento aprovado: **abril primeiro**. Dump de órfãos de abril ✅ feito (`backup-orfaos-abril-D001.json`)|
|Simulação do anti-join jan–jun (20/07)|✅ reproduz a §6 da spec **exatamente** nas 6 competências (jan 49 · fev 67 · mar 58 · **abr 66** · mai 59 · jun 72 = 371 / R$ 1.475.637), rodada contra o MovEstq de hoje (5.139 docs, all-dates)|
|`em_controle` no insert (D-010 etapa 3)|✅ **EM PRODUÇÃO** desde 15/07 nas DUAS rotas (`despesas.ts` MovEstq + `docfin-despesas.ts`). Smoke: MovEstq 17/07 (17 docs/19 rateios), DocFin maio (97 docs/102 rateios)|
|Crons de despesa|✅ ativos (pausados 14–15/07 durante a migração do D-010; reativados após validação)|
|Captura jan–jun/2026 (R$ 18,96M)|✅ íntegra, 0 erros *(número histórico do report v2.0 — ver linha "Total de despesa" acima para o valor atual)*|
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

**Nota (20/07/2026) — 1ª rodada real em produção + escopo do backfill reduzido.** O cron das 15:11 (tentativa 34) reprocessou **junho** com o código novo e o anti-join **admitiu espécies-alvo pela primeira vez em produção**: NF-e `29434` ACURATE (R$ 103.344,87), CT-e `29433`/`29432` TRANSCOURIER, NFS-e `29078`, NFCom `29057`. Junho: 243 → 238 docs / R$ 1.434.526,06 → R$ 1.418.639,00 (**−R$ 15.887,06 líquido**, a decompor no **D-015**). **Consequência para o backfill: maio, junho e julho já rodaram com o código novo pela janela rolante — o escopo cai de 6 para 4 competências (jan, fev, mar, abr).** A §6 da `SPEC-D001-erp-proxy.md` foi atualizada (tabela de delta esperado marca mai/jun/jul como já executadas).

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

**Nota (20/07/2026) — o UNIQUE não fecha a classe inteira do bug.** A limpeza + `uq_desp_docfin_rateio_grao` mataram a duplicação de **linha de rateio** (mesmo `chave_docfin`, grão repetido). Descoberto na análise de órfãos do backfill: existe um segundo sabor — **duplicação de DOCUMENTO**, o mesmo doc físico entrando com `chave_docfin` distintas (o Alvo renumera com sufixo e emite nova chave). O UNIQUE **passa** nesse caso, porque chaves distintas são grãos distintos. Evidências em junho (PC MERCADO LIVRE `0004192`/`0004201`/`0004202`, 4× cada) e em maio (RDESP `20262113074` → `-4`/`-6`/`-12`/`-19`, mesmos valores e datas de emissão). Card próprio: **D-013**. A spec do passo 3 deve cobrir os dois sabores.

### D-007 — Resíduo R$ 300,45: rateio de abril < valor dos docs (não-bloqueante)

**Status:** ✅ **FECHADO 20/07/2026 — causa identificada, documento nominal.** · **Origem:** limpeza do D-006 (14/07/2026).

> **A causa dos R$ 300,45 (20/07/2026).** É **um único documento**: o RDESP `20032026` (chave **27368**), entidade `0001179` **OPENAI LIMITED PARTNERSHIP**, emissão 20/03, competência abril. **Valor do documento R$ 319,98; rateio gravado R$ 19,53** (classe `09.04` DESPESAS MULTAS/JUROS). Diferença **R$ 300,45 — bate ao centavo** com o resíduo do card. O restante do documento está em **classe fora de `incluir_controle`**, e o motor gravou só a linha controlada.
>
> **Não é bug nem arredondamento de rateio percentual** (as duas hipóteses do card original). É a **mesma cegueira de classe do D-008 / D-011**, manifestada aqui como *resíduo de conciliação*: quando um doc tem classes mistas, o motor persiste o doc e grava **apenas** as linhas controladas — então `sum(rateio) < valor_documento` por construção, e a diferença é exatamente a despesa em classe não-controlada. **Corolário útil: `valor_documento − sum(rateio)` por documento é um MEDIDOR da despesa invisível** — funciona onde o doc entrou com classes mistas (não enxerga o doc descartado por inteiro, que não persiste). Vale como instrumento barato para o **D-011**.
>
> Achado durante o dump dos órfãos de abril (o doc é um dos 9 de `backup-orfaos-abril-D001.json`). A suspeita do card de que "o mesmo padrão existe nas outras competências, e são benignas" **se confirma** — e agora tem explicação, não só constatação.

Após a limpeza do D-006, o rateio de abril (**R$ 1.152.546,84**) ficou R$ 300,45 **abaixo** do valor dos docs de abril (**R$ 1.152.847,29**). **Não vem do D-006** (o D-006 removeu inflação; este é um *déficit*). Provável classe fora do controle (doc sem rateio gravado por não ter conta mapeada) ou arredondamento de rateio percentual. Registrado para não renascer como investigação do zero. Ação futura: localizar o(s) doc(s) de abril com `sum(rateio) < valor_documento` e classificar. Verificar se o mesmo padrão existe nas outras competências (as diferenças pequenas rateio×doc vistas no baseline sugerem que sim, e são benignas).

### D-008 — Levantar as classes dos 371 do vazamento (pré-requisito da classificação)

**Status:** ✅ **FECHADO 15/07/2026 — a premissa do card caiu.** Ver bloco "Auditoria das 144 classes" abaixo. *(histórico: em 14/07 o Pedro escolheu a via (b) → spec `SPEC-D010`; a implementação da persistência foi depois CANCELADA — a auditoria mostrou que não havia o que levantar.)* · **Origem:** smoke test de maio (14/07/2026).

> **AUDITORIA DAS 144 CLASSES FORA DO CONTROLE (15/07/2026) — resultado que fecha o card.**
> O Pedro auditou, uma a uma, as 144 classes com `incluir_controle=false`. **NENHUMA é despesa que deveria estar sendo controlada.** Composição: **receita** (01.x vendas, 04.x devoluções de venda, 06.x entradas financeiras, 08.x outras entradas — 41 classes); **NF sem valor financeiro** (02.x remessas, 03.x retornos — 23); **devoluções de compra** (05.x — 10); **reembolsos** (07.x — 6); **adiantamentos e movimentação de caixa** (09.03/09.07/09.08, 10.x, 16.03 — 11); **sintéticos** (cabeçalhos de grupo sem lançamento: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26); **custo de produção/estoque** (11.07 revenda, 12.x fretes de MP/embalagem/insumo, 13.x, 20.x); **ativo imobilizado** (24.x, 26.x); **remessa/retorno/adiantamento de P&D** (25.04, 25.05, 25.08).
> **Conclusão: o filtro atual está CORRETO. Não havia cegueira — havia filtro.** O desenho do módulo é coerente: controla **despesa (opex)** e deixa fora **custo** (vira CMV) e **ativo** (vai ao balanço). Persistir os não-controlados encheria a tela de remessa de amostra, devolução de compra e adiantamento a despachante — ruído puro, mês após mês.
> **Ressalva registrada como card D-011:** as famílias `13.x` e `20.x` merecem uma decisão de fronteira (vários itens são consumidos, não estocados).

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

**Nota (20/07/2026) — a intuição do Pedro se confirmou, e o mecanismo tem nome.** O órfão de RDESP/PC não é doc que "sumiu": é doc **renumerado** pelo Alvo, que reentra com `chave_docfin` nova (ver **D-013**). Censo de órfãos por competência nesta data: **jan/fev/mar = 0** (a rodada de 02/07 re-listou 100%) · **abr = 9 / R$ 22.416,02 doc / R$ 22.115,57 rateio** (são exatamente os 9 docs do D-006, incluindo o PC chave 26217) · **mai = 49** (os 48 + 1 PC MICROLUMEN R$ 7.725 que a rodada de 20/07 não re-listou) · **jun = 31 / R$ 109.889,94**. A perda **não** é função da idade da competência — jan–mar provam isso. **Correção da leitura anterior:** a trava não "identifica e não apaga"; ela apaga abaixo do teto (armadilha 26). Maio só sobreviveu porque 48 > 43.

### D-010 — Persistir despesa de classe não-controlada (visível, fora do total)

**Status:** ✅ **CONCLUÍDO 15/07/2026 com ESCOPO REDUZIDO (Versão A).** Etapas 1, 2 e 3 aplicadas e validadas. A etapa 3b (persistir os não-controlados) foi **CANCELADA por decisão do Pedro** — ver justificativa abaixo. · **Origem:** via (b) do D-008.

**Etapa 1 — schema ✅ (14/07):** coluna `em_controle boolean NOT NULL DEFAULT false` nos dois rateios + backfill + trigger `desp_sync_em_controle` (sincroniza com `incluir_controle`, pulando meses FECHADOS). Verificação bateu com o dry-run: docfin **1070/1070**, realizado **5940/5940**. Migração **neutra** (total inalterado R$ 31.831.095,41).

**Etapa 2 — view + RPCs ✅ (14/07):** `v_despesa_realizada_unificada_base` passou a somar com `FILTER (WHERE em_controle AND COALESCE(cc.incluir_controle,false))` + coluna nova `valor_fora_controle` (LEFT JOIN em `desp_classe_config` por `codigo_classe`, **sem tocar o GROUP BY** — granularidade preservada, 6.151 linhas antes e depois). RPCs `listar_despesa_realizada_unificada` (expõe `soma_fora_controle`) e `get_despesa_realizada_rateios` (expõe `em_controle`). Arquivos: `SPEC-D010-etapa2.sql` + `SPEC-D010-etapa2-rollback.sql`. O 1º `CREATE OR REPLACE VIEW` falhou (coluna nova no meio) → corrigido pondo `valor_fora_controle` por último nas duas metades do UNION (armadilha 23). Validado pela **tela** (`/despesas/realizado` abre e soma) — não pelo SQL Editor, que cai no `_is_admin()`.

**Etapa 3 — proxy ✅ (15/07):** `despesas.ts` (MovEstq) e `docfin-despesas.ts` passaram a setar **`em_controle: true` EXPLICITAMENTE** no insert de rateios, nunca confiando no DEFAULT. Como o `cfgMap` só carrega classes com `incluir_controle=true`, todo rateio gravado é, por construção, controlado. Smoke das duas rotas com movimento real; invariante `fora = R$ 0,00` mantido; crons reativados.

**Etapa 3b — persistir não-controlados: ❌ CANCELADA (15/07).** A auditoria das 144 classes (card D-008) provou que **o filtro atual está correto** — nenhuma delas é despesa que deveria ser controlada. Persistir os não-controlados só geraria ruído permanente na tela (remessas, devoluções, adiantamentos, ativo). **Não havia cegueira, havia filtro.** Consequência: a aba "A Classificar" e a RPC `desp_listar_classes_nao_controladas` **não serão construídas**; o `valor_fora_controle` permanece como instrumento de segurança (detecta rateio que escapou sem flag), não como fila de trabalho.

**Requisito inegociável (mantido e cumprido):** persistir ≠ contar. Fonte única da verdade = `desp_classe_config.incluir_controle`; o total nunca inclui classe fora de controle, mesmo com flag divergente (defesa em profundidade: a view valida os DOIS).

**Cadeia de agregação mapeada (verificada no banco + `src/`):** só a view `v_despesa_realizada_unificada_base` → RPC `listar_despesa_realizada_unificada` → tela `RealizadoDespesas.tsx` somam. `get_despesa_realizada_rateios` só detalha; `desp_recarimbar` só escreve `conta_hierarquica`. Nenhum outro consumidor.

### D-011 — Fronteira despesa × custo de produção (decisão do Pedro, sem urgência)

**Status:** ⬜ aberto · **Origem:** auditoria das 144 classes (15/07/2026). · **Não bloqueia nada.**

As classes **`13.x` — Produção, outros** (EPI/paramentação, material da qualidade, instrumental/ferramentas, produto de limpeza da produção, material de consumo da produção) e **`20.x` — Serviços de terceiros, produção** (industrialização/beneficiamento, **esterilização**, coleta/descarte de resíduos, controle de qualidade, limpeza da produção) estão fora do controle por serem classificadas como **custo**. Contabilmente correto — o módulo escopou-se em **despesa (opex)**.

**Mas vários desses itens são CONSUMIDOS, não estocados** (esterilização, descarte de resíduos, limpeza, EPI): são gasto do período que hoje é **invisível no Hub**. Consequência prática: *se alguém perguntar quanto a P&F gastou com esterilização em 2026, o Hub não sabe responder.*

**Decisão pendente do Pedro:** manter a fronteira em opex puro, ou incluir os custos de produção consumíveis? **Hoje não é possível medir quanto passa por essas classes** — o motor descarta o doc sem deixar rastro (o mesmo mecanismo do D-008). Medir exigiria consulta direta ao Alvo (rota de censo com Load) ou reverter a decisão da etapa 3b do D-010 para essas classes específicas.

> **INSUMO NOVO (20/07/2026) — piso da despesa invisível, medido sem tocar no Alvo.** O corolário do **D-007** (`valor_documento − sum(rateio)` por documento) mede a despesa que está **dentro de documentos já capturados** mas em classes fora de controle. É gratuito: já está no banco.
>
> |mês/2026|DocFin|MovEstq|
> |-|-|-|
> |jan|R$ 0,00|R$ 4.144,98|
> |fev|R$ 0,00|R$ 5.278,67|
> |mar|R$ 0,00|R$ 585,50|
> |abr|R$ 300,45|R$ 10.288,05|
> |**mai**|**R$ 52.651,66** (4,66%)|R$ 1.333,25|
> |**jun**|**R$ 105.828,72** (6,95%)|R$ 3.576,49|
> |jul|R$ 0,00|R$ 0,00|
> |**total**|**R$ 158.780,83**|**R$ 25.206,94**|
>
> **O padrão é o achado: o gap do DocFin é ZERO em jan–abr e explode em mai/jun** — exatamente as competências que rodaram com o anti-join. Documentos de classe mista **só passaram a existir no banco depois do D-001**. **Previsão registrada antes do fato: o backfill de jan–abr vai AUMENTAR esse número, não diminuir.**
>
> Maiores esconderijos: **NF-e ACURATE R$ 83.783,54** (entrou pela 25.02; o resto do documento é invisível) · **DIV ALSCO R$ 26.114,37** · série **DHL/FEDEX** (R$ 9.591 + 9.335,83 + 8.516,02 + 6.630,11 + …, todos entrando só pela 09.04 multas/juros) — **frete internacional, classe 12.x**, o mesmo tema da nota de frete no Backlog da Fase 2.
>
> **Limite do instrumento (declarado):** mede apenas documentos que **entraram** com classes mistas. Não enxerga o doc descartado por inteiro (nenhuma classe controlada) — esse não persiste. Portanto é **piso**, não total.
>
> ---
>
> ### 🔎 QUEBRA POR CLASSE (20/07/2026) — a pergunta decisiva respondida
>
> Método: extrair as classes de `payload_alvo->'DocFinClasseRecDespChildList'` (DocFin) e `payload_alvo->'MovEstqClasseRecDespChildList'` (MovEstq), e listar as que **não viraram rateio**. Recorte 2026, as duas rotas.
>
> |classe|nome|classificação|inc.ctrl|docs|oculto|mai|jun|
> |-|-|-|-|-|-|-|-|
> |**24.01**|COMPRA DE MÁQUINAS/EQUIPAMENTOS|**ativo**|false|2|**85.851,81**|—|83.297,06|
> |**12.01**|FRETE DE MATÉRIAS PRIMAS|custo|false|9|**42.063,90**|21.322,66|19.985,86|
> |**13.01**|COMPRA DE VESTUÁRIO/PARAMENTAÇÃO/EPI|custo|false|4|**33.231,37**|26.404,77|—|
> |20.05|SERVIÇOS - LIMPEZA PRODUÇÃO|custo|false|1|6.547,06|—|—|
> |06.08|DESCONTOS OBTIDOS|**receita**|false|1|6.358,37|—|6.358,37|
> |20.04|SERVIÇOS - CONTROLE DE QUALIDADE|custo|false|4|6.204,00|5.352,00|852,00|
> |13.04|PRODUTO DE LIMPEZA (PRODUÇÃO)|custo|false|4|2.930,00|—|—|
> |13.05|BONIFICAÇÃO/AMOSTRAS RECEBIDAS|custo|false|1|2.766,84|—|2.766,84|
> |13.03|INSTRUMENTAL/FERRAMENTAS/UTENSÍLIOS|custo|false|6|2.641,88|460,00|217,83|
> |20.03|SERVIÇOS - COLETA/DESCARTE DE RESÍDUOS|custo|false|2|2.416,84|792,00|1.624,84|
> |13.07|MATERIAL DE CONSUMO NA PRODUÇÃO|custo|false|5|835,22|—|604,65|
> |24.05|SOFTWARE|**ativo**|false|2|545,41|225,43|—|
> |12.03|FRETE DE INSUMOS DE PRODUÇÃO|custo|false|1|205,50|—|—|
> |25.05|P&D - RETORNO DE REMESSA P/ INDUSTRIALIZAÇÃO|outros|false|1|10,95|—|10,95|
> |**total**| | | |**43**|**R$ 192.609,15**| | |
>
> **✅ RESPOSTA À PERGUNTA DE ESCOPO: NENHUMA classe com `classificacao='despesa'`. Zero.** Não existe despesa fora do controle por erro de configuração — **não há urgência técnica**. Composição: **custo 51,8% (R$ 99.842,61) · ativo 44,9% (R$ 86.397,22) · receita 3,3% · outros 0,006%**. É **integralmente a fronteira do D-011** — decisão de escopo do Pedro, não bug.
>
> **Três leituras que orientam a decisão:**
> 1. **O maior item é ATIVO, não custo.** A 24.01 (R$ 85.851,81) é a NF-e ACURATE — máquinas/equipamentos. Não é candidata a despesa em hipótese alguma: vai ao balanço. **Isso responde, com número, o item 3 do D-001-A1** ("decidir se imobilizado entra em despesa realizada"), aberto desde 13/07: **não entra**.
> 2. **A 13.01 é literalmente o exemplo escrito neste card** ("vários desses itens são consumidos, não estocados"): EPI/paramentação, R$ 33.231,37, dos quais R$ 26.404,77 é ALSCO (toalheiro/uniforme). É o caso mais forte a favor de mover a fronteira.
> 3. **A 20.02 NÃO aparece — porque o Pedro a ligou hoje.** As irmãs **20.03 (resíduos) + 20.04 (qualidade) + 20.05 (limpeza) somam R$ 15.167,90** e continuam ocultas. Se o raciocínio que justificou a 20.02 vale para elas, são as próximas candidatas naturais.
>
> **Reconciliação declarada:** esta soma (R$ 192.609,15) difere do corolário agregado (R$ 183.987,77). Diferença explicada: **06.08 DESCONTOS OBTIDOS R$ 6.358,37** é *receita* dentro de doc de despesa (reduz, não soma) e ~R$ 2,2 mil de docs onde `sum(rateio) > valor_documento`, que o corolário zera via `greatest(...,0)` e este recorte não. As duas medições estão corretas; medem coisas ligeiramente diferentes.
>
> **⚠️ Observação sobre extrapolação anual — NÃO é estimativa.** A média de ~R$ 79 mil/mês (mai+jun) projetaria ~R$ 1M/ano, **mas esse número não deve ser usado**: são apenas **duas competências**, ambas com o anti-join recém-aplicado, e a previsão registrada é de que **jan–abr aumente a base** quando o backfill rodar. Qualquer anualização hoje seria a armadilha 20 (dedução no lugar de medição) aplicada a uma série de 2 pontos. **O número anual só existe depois do backfill completo.**
>
> **🔗 Amarração com o Backlog da Fase 2 (frete):** a **12.01 (R$ 42.063,90) + 12.03 (R$ 205,50)** são a face medida da pendência de frete já registrada no Backlog e na nota do D-004-A1. A série **DHL/FEDEX** entra no Hub **só pela 09.04 (multas/juros)** — centavos — enquanto o corpo do documento (frete internacional de matéria-prima) fica na 12.01, invisível. Isso confirma, por um segundo caminho independente, o que os 14 CT-e da transportadora ent 0000132 (armadilha 18) já indicavam: **frete não existe como linha de despesa própria no Hub**. Para o **orçamento por setor** da Fase 2 isso é bloqueante — e agora tem valor: **R$ 42,3 mil em 2026 só nos docs de classe mista já capturados.**

> **✅ RESOLVIDO 20/07/2026 para ESTERILIZAÇÃO — com número MEDIDO, não estimado (nota, o card fica aberto para o resto de 13.x/20.x).**
> A pergunta do card ("*se alguém perguntar quanto a P&F gastou com esterilização em 2026, o Hub não sabe responder*") foi respondida com medição direta no Alvo. **Método:** `/alvo/passthrough` do erp-proxy — `DocFin/RetrievePage` para listar + `DocFin/Load` de **cada** documento, agregando doc a doc a partir dos Loads (**não** de relatório do Alvo). Entidade **OXIMED (0000143)**, 12 meses (jul/2025–jun/2026), **84 documentos, 0 erros, 0 pulados**. Detalhe em `oximed-12m.csv`.
>
> |Classe|docs|valor|%|
> |-|-|-|-|
> |**20.02** SERVIÇOS - ESTERILIZAÇÃO (produção)|77|**R$ 163.839,39**|92,1% — era **invisível**|
> |**25.10** P&D - SERVIÇOS - ESTERILIZAÇÃO|7|R$ 14.017,01|7,9% — já capturada|
> |**Total**|**84**|**R$ 177.856,40**| |
>
> **A causa não era erro de configuração.** Existem **duas** classes de esterilização (armadilha 29) e o volume **migrou de P&D para produção** conforme os produtos amadureceram — o Hub foi ficando cego progressivamente. Explica o sintoma que ninguém sabia nomear: 8 notas da OXIMED em 2025 e **zero** em 2026. Era a fronteira despesa×custo passando por cima de um gasto que crescia.
>
> **Escritas do Pedro (20/07, no rito):** de-para **20.02 → `5.3.01.005.009`** (Beneficiamento de Terceiros) via `desp_set_conta_classe` → gravado em `desp_classe_conta` (16:45:22) · **`incluir_controle=true` na 20.02** (16:45:58). Conferido por leitura. **Captura futura resolvida.** O histórico (R$ 163,8k) exige re-sync do MovEstq → card **D-014**.

**Nota relacionada (Fase 2):** o mesmo raciocínio vale para **frete** — as classes 12.01/12.02/12.03 (frete de MP, embalagem, insumo) estão fora por comporem custo de aquisição, e os 14 CT-e da transportadora ent 0000132 (armadilha 18) mostram frete compondo o custo da mercadoria no MovEstq. Para o **orçamento por setor** da Fase 2, isso importa: frete não existe como linha de despesa própria.

### D-012 — Re-medição da conversão do anti-join: R$ 6.362 → R$ 588,69 (correção de fato, não de plano)

**Status:** ✅ MEDIDO 20/07/2026 · **Origem:** leitura de abertura do backfill de abril. · **Não altera o D-001 nem a armadilha 22** (regras 0.2/0.4) — corrige o **número**, que estava superestimado em 10,8×.

**O erro.** O smoke de maio (14/07) registrou "10 docs geraram rateio, R$ 6.362". Desses R$ 6.362, **R$ 5.773,30 são de UM único DIV** (`MARCIO JOSE MONTENEGRO DA COSTA`, classe 14.04) com `sync_em` = **18/06/2026** — captura da versão ANTIGA do código, e justamente um dos 48 órfãos do D-009. **Esse doc não é candidato do anti-join:** conferido no `censo-jan-jun.json`, ele não aparece na lista de descartados. Foi contado como ganho do D-001 sem ser.

**Medição correta (maio, docs com `sync_em` = 20/07, os únicos admitidos pelo código novo):**

|espécie|admitidos (censo)|docs persistidos|Σ valor_documento|Σ rateio gravado|classes|
|-|-|-|-|-|-|
|DIV|7 / R$ 50.691,60|5|46.854,18|**327,80**|09.04|
|NFS-e|21 / R$ 67.278,51|3|6.144,00|**231,18**|09.04|
|NF-e|25 / R$ 35.003,94|1|25,71|**29,71**|09.04, 25.02|
|CT-e|4 / R$ 3.589,10|0|—|—|—|
|NFCom|2 / R$ 14.718,10|0|—|—|—|
|**total**|**59 / R$ 171.281,25**|**9**|**53.023,89**|**R$ 588,69**|

**Conversão real: 9/59 docs = 15,3% · R$ 588,69 / R$ 171.281 = 0,34% do valor** (não 3,7%). **8 dos 9 docs caíram em 09.04 (multas/juros)** — o corpo da despesa está em classe não-controlada.

**Contraponto que impede extrapolar 0,34% linearmente:** julho — competência inteira sob o código novo — tem 4 docs de espécie-alvo (3 NF-e + 1 CT-e) com R$ 15.102,27 de valor de documento e **R$ 15.102,27 de rateio: 100% de conversão**, incluindo R$ 10.800 na classe 11.03 (insumos de produção, controlada). **Quando a classe é controlada, converte inteiro.** A conversão é função do mix de classes, não uma taxa fixa.

**Consequência para a expectativa do backfill:** para abril (44 NF-e / R$ 195k + 14 NFS-e / R$ 157k + 5 DIV + 3 CT-e), faixa **R$ 1 mil – R$ 15 mil** e ~8–12 docs com rateio. Nunca apresentar R$ 385,7k como despesa a recuperar (armadilha 22), nem os R$ 55 mil da extrapolação anterior.

### D-013 — Duplicação de DOCUMENTO (não de linha) em RDESP/PC: o D-006 num sabor que o UNIQUE não cobre

**Status:** ⬜ ABERTO, **bloqueia o backfill de junho** (não bloqueia abril) · **Origem:** análise de órfãos do backfill (20/07/2026). · Parente do D-006 e do D-009.

O `uq_desp_docfin_rateio_grao` protege o grão `(chave_docfin, ordem_classe, ordem_rateio)`. **Ele não protege contra o mesmo documento físico entrar com `chave_docfin` DIFERENTES** — chaves distintas são grãos distintos, o UNIQUE passa, e o valor conta duas vezes.

**Evidência em junho (31 órfãos / R$ 109.889,94, quase todos PC):** `0004192`, `0004201` e `0004202` (todos MERCADO LIVRE, ent 0000043, emissão 15/06) aparecem **4× cada**, com `chave_docfin` distintas e valores diferentes entre si (o `0004202`: R$ 5.454,05 · 5.815,15 · 5.815,15 · 5.132,20).

**Evidência em maio (mesma mecânica, RDESP ent 0000934):** o Alvo re-emite o documento com sufixo no número e gera nova `chave_docfin` — `20262113074` (sync 03/06) vs `20262113074-4`/`-6`/`-12`/`-19` (sync 14–20/07), **mesmos valores (65,88 · 55,98 · 41,60), mesmas datas de emissão**. Isso explica por que os 38 RDESP de 03/06 viraram órfãos: não sumiram, foram **renumerados**.

Consequência prática: os órfãos de RDESP/PC são, em boa parte, **duplicatas que a limpeza da trava corrige** — mas isso precisa ser verificado por competência, nunca presumido. **Junho merece análise própria antes do backfill** (teto da trava = max(25, 30%×243) = 72 → os 31 serão apagados; é preciso saber quantos têm gêmeo antes de deixar rodar).

### D-014 — Re-sync do MovEstq para capturar o histórico da 20.02 (esterilização, R$ 163,8k)

**Status:** ⬜ NÃO EXECUTADO, precisa de **plano de lotes** · **Origem:** D-011 resolvido para esterilização (20/07/2026).

Com a 20.02 agora em `incluir_controle=true` + de-para gravado, **a captura futura está resolvida**. O **histórico não volta sozinho**: os documentos já sincronizados foram descartados na época por classe fora de controle (o motor não persistiu — mesmo mecanismo do D-008/armadilha 22), então é preciso **re-sincronizar o MovEstq** no período.

**O obstáculo é operacional, não lógico:** o MovEstq sincroniza **por dia**, são **~250 dias úteis** no período de interesse, e o **watchdog corta em 80s**. Rodar tudo de uma vez não funciona. Precisa de **plano de lotes** (dimensionar dias por rodada dentro do orçamento de 80s, retomada por cursor, idempotência já garantida pelo `uq_desp_rateio_grao`).

O agente escreve o plano de lotes quando o Pedro priorizar. **Não iniciar sem ele** — disparar 250 dias no escuro é receita de rodada morta pelo watchdog e estado parcial.

### D-015 — Decompor os −R$ 15.887,06 de junho nas três parcelas

**Status:** ✅ **CONCLUÍDO 20/07/2026 — decomposição fecha ao centavo.** · **Origem:** primeira rodada real do D-001 em produção (20/07/2026).

> **Resultado — as duas parcelas, medidas (não estimadas):**
>
> |parcela|docs|rateio|
> |-|-|-|
> |**(a) admitidos pelo anti-join**|**+27**|**+R$ 113.802,88**|
> |**(b) removidos pela limpeza de órfãos**|**−32**|**−R$ 129.689,94**|
> |**líquido observado**|**−5**|**−R$ 15.887,06** ✅ bate|
>
> **Método:** junho **não tinha nenhuma espécie-alvo antes** da rodada (verificado), então os 27 são 100% ganho novo. A composição por espécie fecha exatamente: PC 34→3 (−31) e CRT 1→0 (−1) = −32; CT-e +11, NFS-e +6, DIV +5, NF-e +2, NF3E +2, NFCom +1 = +27. Os removidos somam **R$ 129.689,94 de valor de documento — idêntico ao rateio**, porque PC/CRT rateiam 100%.
>
> **Achado 1 — foram 32 removidos, não 31.** Os 31 órfãos que eu havia catalogado (R$ 109.889,94) **mais um PC de R$ 19.800,00** que tinha `sync_em` de 14/07 e não foi re-listado em 20/07. **Órfãos continuam sendo gerados a cada rodada** — não é um passivo estático que se drena.
>
> **Achado 2 — a parcela (b) NÃO é homogênea. Tem quatro sabores, e a maior parte tem contrapartida:**
>
> |sabor|valor|evidência|
> |-|-|-|
> |**substituição PC → NFS-e/NF-e** (armadilha 27) — remoção **correta**|**R$ 57.618,33**|**VR BENEFÍCIOS PC 4234 R$ 54.535,71 = NFS-e 98084371 (R$ 50.935,71) + NFS-e 98084370 (R$ 3.600,00)**, ambas **admitidas nesta mesma rodada** — soma **exata**. Mais GRÁFICA FB CAZA 1.200 (NF-e no MovEstq 18/06), HERO 1.007,62 e IBPIS 875 (NFS-e no MovEstq)|
> |**duplicata de DOCUMENTO** (D-013) — remoção **correta**|R$ 24.747,55 bruto (~R$ 17.871,65 de excedente)|4 grupos de mesmo número com `chave_docfin` distintas: `0004192`×3, `0004201`×3, `0004202`×4, `0004212`×2 (MERCADO LIVRE / RAPHAELA)|
> |**migração de competência** — não é perda|R$ 7.725,00|MICROLUMEN PC `0004034`: removido de junho, **existe em maio** (`sync` 14/07)|
> |**sem substituto identificado** — risco real|**R$ 15.879,91**|ABIMO R$ 10.752 · RIOPRETRANS R$ 1.729 · VOOLT R$ 1.292,18 · 3D SLIM R$ 1.228,34 · F3DBR R$ 599,94 · ALIMENTOS REMURO R$ 200 · PRO LAB R$ 78,45|
>
> **REVISÃO 20/07 (o Pedro apontou que a busca parou cedo — estava certo).** A fatia "sem substituto" caiu de R$ 39.599,06 para **R$ 15.879,91 (−60%)** só com mais leitura, sem tocar no Alvo. Substitutos adicionais encontrados: **o PC de R$ 19.800 era BIOCOLLAGEN — NF-e `1563` de R$ 19.800 está no MovEstq (mov 18/06)** · HERO `0004145` R$ 814,40 (NFS-e 12064) · VR(742) `PC 3182` R$ 799,87 (re-emitido como `20268 - 3182` em **julho** + NFS-e no MovEstq) · BOX BRASIL CRT R$ 679,19 (série mensal `20262`–`20266` + DIV no MovEstq 10/07) · PEVE TUR R$ 624,80 · 3DC RESINAS R$ 580,89 · GRÁFICA `0004209` R$ 265 · METROTEC R$ 155. **Fechamento exato: 81.337,48 + 24.747,55 + 7.725,00 + 15.879,91 = R$ 129.689,94.**
>
> **Restam 7 documentos** para o Pedro rodar `DocFin/Load` (as `chave_docfin` foram apagadas junto; localizar por `RetrievePage` espécie=PC + comp 06/2026, casando por número): `0004351` ABIMO R$ 10.752 · `4220` RIOPRETRANS R$ 1.729 · `0004306` VOOLT R$ 1.292,18 · `0004213` 3D SLIM R$ 1.228,34 · `0004309` F3DBR R$ 599,94 · `0004139` ALIMENTOS REMURO R$ 200 · `0004284` PRO LAB R$ 78,45. Perguntas: (a) existe no Alvo? (b) em que competência está hoje? (c) foi cancelado? O que sobrar é perda real.
>
> **Lição de método registrada:** "sem substituto identificável" **não é conclusão, é estado da busca**. A primeira passada testou só os 10 maiores; ampliar a busca aos 13 restantes eliminou 60% do saldo. Antes de declarar perda, esgotar a busca **nas duas fontes, all-dates, por entidade+valor** — e só então recorrer ao Alvo.
>
> ---
>
> ### ⚠️ CORREÇÃO FINAL (20/07/2026, Pedro) — a perda real de junho é **R$ 77,06**, não R$ 15.879,91
>
> O Pedro recuperou as chaves via `DocFin/RetrievePage` e rodou o `Load` dos documentos restantes. **7 dos 8 são `Projeção = Sim`:** ALIMENTOS REMURO · 3D SLIM · RIOPRETRANS · VOOLT · F3DBR · PRO LAB (chave 28772) · ABIMO — **R$ 15.802,85**.
>
> **Projeção nunca é despesa real** — é ferramenta auxiliar de planejamento no Alvo, e o motor filtra `Projecao == 'Não'` (regra 6). Esses documentos eram **resíduo de uma versão antiga do código** que os capturou indevidamente; a versão atual não os lista, por isso viraram órfãos e foram removidos. **A remoção estava CERTA — corrigiu uma sujeira antiga.**
>
> **Perda real: R$ 77,06 — um único documento, PRO LAB chave 28773.** E o "8 documentos onde havia 7" se explica sozinho: **PRO LAB tem duas chaves com o mesmo número** (28772 = R$ 1,39 e 28773 = R$ 77,06, somando os R$ 78,45 que eu havia registrado como um doc só) — **mais um caso do D-013** (duplicação de documento), encontrado de brinde.
>
> **Verificado por leitura independente (20/07):** `desp_docfin_doc` tem **1.025 docs, 100% `Projecao='Não'`, zero `Sim`**; `desp_realizado_doc` **5.139 docs, zero `Sim`**. Não há projeção remanescente em nenhuma das duas rotas — **o total do Hub está limpo**.
>
> **A sequência completa, que é a lição:**
>
> |passada|"sem contrapartida"|o que faltava verificar|
> |-|-|-|
> |1ª — 10 maiores testados|R$ 39.599,06|busca incompleta (13 não testados)|
> |2ª — todos testados nas 2 fontes|R$ 15.879,91|origem no Alvo (`Projeção`)|
> |**3ª — `Load` no Alvo**|**R$ 77,06**|—|
>
> **Duas vezes seguidas, "sem contrapartida identificável" era estado da busca, não conclusão** — e cada rodada de verificação derrubou o número **uma ordem de grandeza**. Checklist obrigatório na **armadilha 33**.
>
> **Conclusão que muda o critério de aceitação:** o líquido negativo **não** significa perda de despesa. Em junho, **~70% da remoção tem contrapartida comprovada** (substituição, duplicata ou migração). Mas **R$ 39.599,06 saíram sem substituto identificável** — e como foram apagados sem dump (armadilha 32), **não há como recuperá-los nem investigá-los além disto**. É a justificativa empírica do **D-016**.
>
> **Gabarito para abril:** esperar (a) positivo pequeno e (b) dominado por PC/RDESP; classificar (b) nos quatro sabores **antes** de concluir qualquer coisa sobre o líquido. Em abril os 9 órfãos já estão classificados (1 substituição PC→NFS-e de R$ 22.000 + 8 sem gêmeo de R$ 115,57) **e com dump feito** — o inverso da situação de junho.

Junho fechou em **−5 docs / −R$ 15.887,06 líquido**, resultado de forças opostas. Decompor nas três parcelas do critério de aceitação (armadilha 26):

* **(a) admitidos novos** pelo anti-join (as espécies-alvo que entraram),
* **(b) órfãos removidos** pela limpeza da trava (eram 31 / R$ 109.889,94 — teto max(25; 72) = 72, logo apagou),
* **(c) dupla contagem eliminada.**

Fonte para diferenciar: **`censo-jan-jun.json`** (quem era candidato do anti-join vs quem era doc pré-existente). **Reforça o critério de aceitação do backfill** de jan–abr: é o primeiro caso real com as três parcelas juntas e serve de gabarito para abril.

### D-016 — Auditoria/quarentena de órfãos: tornar a deleção reversível por construção

**Status:** 🔧 **PASSO 1 APLICADO E VERIFICADO 20/07/2026** (`SPEC-D016-passo1.sql`). Passo 2 (proxy) especificado em `SPEC-D016-passo2.md`, aguardando implementação do Pedro. · **APROVADO 20/07 — implantar ANTES do backfill de abril.**

> **Passo 1 — resultado real (20/07/2026):**
> * `desp_docfin_orfaos` criada — **0 linhas, RLS ativo, 0 policies, 5 índices** ✅
> * `desp_remover_orfaos_verificado` criada — **`SECURITY DEFINER` = true** ✅
> * Grants conferidos: **`service_role` = true · `anon` = false · `authenticated` = false** ✅ (o alvo exato)
> * **V4 — o teste que importa: a guarda LEVANTOU EXCEÇÃO.** `P0001: D016: 1 chave(s) sem snapshot - remocao abortada: {999999999}`, na linha do `RAISE`. **Não retornou zero silencioso** — o invariante está de pé.
> * **Nota de execução → armadilhas 34 e 35:** o bloco `BEGIN...COMMIT` único **abortou inteiro** (tabela e função em 0); só funcionou em **três partes** (tabela+índices+RLS · função `$$` · REVOKE+GRANT). E o `REVOKE ALL ... FROM public` **revogou também do `service_role`** — foi preciso acrescentar `GRANT EXECUTE ... TO service_role` e verificar.
 Desenho em `SPEC-D016-orfaos-auditoria.md`; **código pronto em `SPEC-D016-codigo.md`** (DDL + RPC atômica + TypeScript do proxy + queries de conferência). Implementação e deploy: Pedro, nos 4 passos com observação entre eles. · **Origem:** achado durante o backfill do D-001 (20/07). · **Prioridade alta: o risco é contínuo e silencioso.**

**Argumento adicional do Pedro (20/07) — implantar antes de abril simplifica o backfill:** com o cron parando de apagar, **o delta de abril vira puramente positivo** — só admissões, sem subtração na mesma rodada. O critério de aceitação **cai de três parcelas para duas** e a leitura fica trivial. Junho foi difícil de ler exatamente porque as duas coisas aconteceram juntas (ver D-015).

**Decisões fechadas:** (1) o motor **nunca apaga por padrão** — nem cron nem manual; remoção exige `permitir_remocao_orfaos=true` explícito; (2) snapshot gravado **na detecção**, não na remoção; (3) verificação do snapshot **dentro da transação** (RPC `desp_remover_orfaos_verificado`, `SECURITY DEFINER`) — o cliente JS do Supabase não abre transação, então a atomicidade vive no banco.

**O problema (levantado pelo Pedro).** O dump prévio da armadilha 28 protege **só o backfill manual**. Mas a limpeza de órfãos roda em **toda rodada do cron — 3×/dia, sobre as 3 competências da janela rolante** — e apaga **irreversivelmente, sem registro**. A trava de teto impede deleção em massa, mas **deleção pequena (≤25 docs) passa silenciosa**: uma listagem parcial do Alvo num dia ruim remove documentos e ninguém fica sabendo. **`mai/jun/jul` estão permanentemente desprotegidas.**

**Precedente já consumado:** a rodada de 20/07 15:11 removeu **31 órfãos de junho / R$ 109.889,94 sem dump**. Não há como saber hoje quanto era duplicata legítima (D-013) e quanto era despesa real.

> **⚠️ HONESTIDADE SOBRE A JUSTIFICATIVA (20/07, após o `Load` do Pedro).** A investigação completa mostrou que **a perda real de junho foi de R$ 77,06**, não os R$ 39.599 nem os R$ 15.879 estimados nas passadas anteriores (ver D-015). **Isso enfraquece a justificativa empírica deste card — e está registrado como tal, não escondido.** A limpeza automática, naquele caso, **acertou**: removeu projeções e duplicatas que não deviam estar ali.
>
> **O card permanece, pelo argumento estrutural, que não depende do tamanho da perda:**
> 1. **O ponto nunca foi quanto se perdeu — é que deleção sem registro torna a investigação impossível.** Chegar aos R$ 77,06 exigiu **recuperar chaves de documentos já apagados** via `RetrievePage` + 8 `Load` individuais no Alvo. Com a quarentena no ar, seria **um `select` de dez segundos**.
> 2. **O resultado favorável foi sorte desta amostra, não garantia do mecanismo.** Nada no código impedia que os R$ 15.879 fossem despesa real — a mesma rodada teria apagado do mesmo jeito, e o valor seria irrecuperável. Proteção não se avalia pelo resultado de uma execução, e sim pelo pior caso que ela admite.
> 3. **O custo é trivial e o benefício é permanente:** ~0,5 MB por competência, e cada órfão futuro chega com snapshot + evidência de gêmeo, alimentando D-009 e D-013 sem arqueologia.
>
> Argumento adicional que sobreviveu intacto: com o cron parando de apagar, **o delta de abril vira puramente positivo** e o critério cai de 3 para 2 parcelas.

**Solução (mesma filosofia do UNIQUE do D-006 — proteção estrutural, não disciplina):** tabela `desp_docfin_orfaos` (quarentena com snapshot completo: `doc_json` com `payload_alvo` + `rateios_json`), gravada **na detecção** (quando o doc ainda existe) e **na mesma transação** da deleção. Invariante: *nenhum doc é apagado sem registro já commitado com `doc_json` não-nulo* — verificado dentro da transação, não presumido.

**Recomendação do agente sobre a política (a decisão principal do card): o motor NUNCA apaga por padrão — nem cron, nem backfill manual. Remoção exige flag explícita `permitir_remocao_orfaos=true`.**

Argumento — **assimetria do erro**, a mesma lógica da armadilha 25 aplicada à deleção:

|erro|manifestação|detectabilidade|
|-|-|-|
|apagar doc que deveria ficar|despesa **some**, total cai|**invisível** — ninguém questiona número menor|
|não apagar doc que deveria sair|duplicata fica, total **sobe**|**visível** — o valor destoa|

Custos assimétricos ⇒ **o default seguro é o que erra na direção visível**. Reforço empírico do **D-013**: a causa dominante de órfão **não é cancelamento no Alvo, é renumeração/listagem parcial** — apagar automático é apostar que a listagem daquele instante é a verdade, 3×/dia, sem testemunha. O custo de não apagar (órfão-duplicata inflando o total) é **aceitável porque é visível e vira fila de trabalho**; hoje o mesmo custo existe invertido e invisível.

**Efeito colateral:** D-009 e D-013 deixam de ser arqueologia — cada órfão passa a chegar com snapshot e campos `tem_gemeo`/`gemeo_ref`. E a parcela (c) do critério de aceitação (armadilha 26) passa a ser **lida** da tabela em vez de estimada por diferença.

### D-017 — Política de retenção do snapshot da quarentena (`doc_json`)

**Status:** ⬜ **DECISÃO PENDENTE do Pedro, não bloqueia nada** · **Origem:** passo 2 do D-016 (20/07/2026).

`desp_docfin_orfaos.doc_json` guarda o `payload_alvo` inteiro — **~15–16 KB por documento**. Como o `ON CONFLICT DO UPDATE` atualiza in-place, **re-detecção não faz a tabela crescer**: cada órfão ocupa uma linha só, para sempre. O crescimento vem só de **órfãos novos** (junho: 31 ≈ 0,5 MB ⇒ ordem de **poucos MB/ano**).

**A pergunta:** órfãos `REMOVIDO` de competências **FECHADAS** precisam manter o snapshot para sempre? Depois do fechamento e da conciliação, a chance de restaurar cai a ~zero — mas o valor de **auditoria** permanece (é o registro do que o motor apagou).

**Opções:** **(a)** reter para sempre — simples, defensável, custo baixo · **(b)** após N meses do fechamento, esvaziar só `doc_json`/`rateios_json` **mantendo a linha** com os campos desnormalizados (perde restauração, preserva auditoria) · **(c)** expurgo total após N meses — **não recomendado**, reintroduz a cegueira que o D-016 combate.

**Recomendação do agente: (a) até haver evidência de volume**, revisitando se a tabela passar de ~100 MB. Enquanto não houver decisão, vale (a) por omissão — **e essa omissão é a segura** (mesma lógica da armadilha 25: o default que preserva é o que erra na direção visível).

### D-018 — Auditoria de paginação: todo `.range()` sem `.order()` nas duas rotas

**Status:** ⬜ **ABERTO — auditoria a executar pelo Pedro** (o agente não lê o `erp-proxy`, regra 11; entrega o checklist e a análise de impacto) · **Origem:** achado do Pedro ao revisar a RPC do D-016 (20/07/2026). · **Parente direto do D-006.**

**O achado:** a paginação que monta `chavesNoBanco` em `docfin-despesas.ts` usa `.range()` **sem `.order()`**. Sem ordenação explícita a ordem entre páginas não é estável (armadilha 36) — a mesma linha pode vir duas vezes, e outra pode não vir nenhuma.

**Checklist da auditoria** (`grep` por `.range(` nos dois arquivos):

|#|local|risco se instável|gravidade|
|-|-|-|-|
|1|`docfin-despesas.ts` → `chavesNoBanco`|chave repetida no lote ⇒ `ERROR 21000` no `ON CONFLICT`|**média** — falha barulhenta, visível|
|2|`docfin-despesas.ts` → **`carregarIndiceMovEstq`**|linha **faltando** ⇒ anti-join conclui "não está no MovEstq" ⇒ **ADMITE ⇒ DUPLA CONTAGEM**|🔴 **alta — silenciosa**|
|3|`despesas.ts` (MovEstq) → toda paginação|doc processado 2× ou pulado|**média/alta**|
|4|qualquer paginação de listagem do Alvo|doc não listado ⇒ vira **órfão** ⇒ apagado (antes do D-016)|**alta** — é provavelmente parte da origem dos órfãos de RDESP/PC|

**Correção:** `.order("<coluna única>", { ascending: true })` **antes** do `.range()` — `chave_docfin`, `chave_movestq` ou `id`. Nunca ordenar por coluna não-única (data, número, valor): empate reintroduz a instabilidade, que é exatamente o que o D-006 diagnosticou (`numero` = data em RDESP, lote na mesma data, boundaries de página caindo no empate).

**⚠️ Consequência para o critério de aceitação do backfill de abril.** A simulação que reproduziu **66 admitidos** (§6 da spec) rodou em **SQL direto, sem paginação**. O proxy pagina o índice do MovEstq. **Se o item 2 estiver instável, o resultado real pode divergir da simulação — e a divergência seria da paginação, não do anti-join.** Se `antijoin_admite ≠ 66` em abril, **investigar a paginação antes de suspeitar da lógica de admissão**. Isto reforça fazer o D-018 junto com o passo 2 do D-016, antes do backfill.

**Nota de leitura sobre o histórico:** o smoke de maio bateu exatamente (59 = previsto), o que sugere que o índice veio íntegro **naquela execução**. Não prova estabilidade — paginação instável é intermitente por natureza, e o próprio D-006 só se manifestou numa rodada específica de abril.

*(novos cards entram aqui: D-019, D-020, ...)*

\---

## 3\. Backlog — Fase 2 (não iniciar sem card)

* Telas por setor (de-para CC → Setor pronto, Seção 4 do report).
* Conciliação automática mensal razão × captura (metodologia validada: FI por número+fornecedor; FP/IP por conta contábil; CB fora do perímetro).
* **Frete — MEDIDO em 20/07/2026 (era só qualitativo até aqui):** a quebra por classe do D-011 mostra **12.01 FRETE DE MATÉRIAS PRIMAS = R$ 42.063,90** + **12.03 FRETE DE INSUMOS = R$ 205,50** ocultos em 2026, só nos docs de classe mista já capturados. A série **DHL/FEDEX** entra no Hub **apenas pela 09.04 (multas/juros)** — centavos — com o corpo do frete internacional invisível na 12.01. **Segundo caminho independente** confirmando os 14 CT-e da ent 0000132 (armadilha 18). Bloqueante para o orçamento por setor: **frete não existe como linha de despesa própria**, e agora se sabe quanto.
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
23. **`CREATE OR REPLACE VIEW` só ACRESCENTA coluna no fim (adicionada 14/07/2026).** O Postgres não deixa inserir coluna no meio, reordenar nem renomear colunas de uma view existente via `CREATE OR REPLACE` — só **adicionar novas no fim** e **mudar a expressão** de colunas existentes (mantendo nome+tipo). Tentar pôr uma coluna nova no meio dá `cannot change name of view column "X" to "Y"`. Ao evoluir `v_despesa_realizada_unificada_base` (ou qualquer view viva), a coluna nova vai **por último**, ordem idêntica nas duas metades de um `UNION ALL`. **`DROP VIEW` é vetado** (derruba dependências) → o rollback também não pode remover a coluna: reverte a **semântica** (expressão volta ao original, coluna nova vira constante `0`) mantendo o mesmo nº de colunas. Caso concreto: etapa 2 do D-010.

24. **`data_competencia` é NULL na maior parte da base — NUNCA filtrar por ela (adicionada 15/07/2026).** As tabelas `desp_*` têm `data_competencia` frequentemente nulo (o Alvo nem sempre preenche). Por isso o motor grava `ano`/`mes` do rateio a partir de `COALESCE(data_competencia, data_movimento)` — **esse é o campo temporal canônico do módulo**. Filtrar por `data_competencia` perde silenciosamente a maior parte dos dados: uma query `where data_competencia >= '2026-01-01'` (mais 2024/2025) somou **R$ 10,7M** quando o total real era **R$ 31,8M** — dois terços da despesa invisíveis, e o resultado *parece plausível*. **Regra: todo recorte temporal em `desp_*` usa `ano`/`mes` do rateio.** Afeta qualquer conciliação futura, incluindo a comparação contra o razão da Fase 2 e qualquer relatório para auditoria.
25. **`DEFAULT false` em flag de inclusão — validado empiricamente (adicionada 15/07/2026).** Ao criar `em_controle`, o desenho inicial propunha `DEFAULT true` ("retrocompatível"). O Pedro exigiu **`DEFAULT false`**, com o argumento de que o default governa linhas **futuras**, e a linha futura perigosa é justamente a que o proxy grava sem setar o campo. **A decisão se provou no primeiro teste real:** entre o DDL da etapa 1 e o deploy da etapa 3, os syncs gravaram 41 rateios sem o campo → **R$ 648.963,95 caíram fora do total** (`valor_fora_controle` acusou na hora; classes com `incluir_controle=true`, ou seja, a flag é que estava errada). Corrigido por UPDATE em minutos. **Com `DEFAULT true`, o mesmo esquecimento teria feito o valor ENTRAR no total em silêncio e ninguém saberia.** Regra geral: **em flag que controla inclusão em total financeiro, o default seguro é o que EXCLUI** — errar excluindo é visível (alguém nota o número caindo), errar incluindo é invisível. É a armadilha 20 (assimetria do erro) aplicada a DDL. Corolário: **o insert do proxy seta a flag SEMPRE, explicitamente, nunca confiando no default.**

26. **Trava de órfãos: ela LIMPA por padrão; só aborta acima do teto (adicionada 20/07/2026 — corrige leitura errada do agente).** A trava não é "detecta e não apaga". Ela **apaga os órfãos**, e só **aborta** quando eles excedem `max(25 ; 30% dos docs da competência no banco)`. Maio abortou porque **48 > 43** (30% de 146) — o não-apagar foi a EXCEÇÃO, não o comportamento default. Abril: teto `max(25 ; 47)` = 47, órfãos = 9 → **a limpeza roda e apaga**. Junho: teto 72, órfãos 31 → **também apaga**. **Consequência obrigatória para todo backfill:** o delta de uma competência reprocessada tem DUAS parcelas de sinais opostos — ganho do anti-join (+) e limpeza de órfãos (−) — e **o líquido pode ser negativo**. Nunca apresentar o delta líquido sem decompor; caso contrário a despesa cai e parece quebra. Antes de reabrir qualquer competência: contar os órfãos, comparar com o teto, e **verificar gêmeo doc a doc** (órfão com gêmeo = duplicata, apagar corrige; órfão sem gêmeo = despesa real, apagar subestima).
27. **`sync_em` é o carimbo que identifica órfão — e o gêmeo pode estar na OUTRA fonte e em OUTRA competência (adicionada 20/07/2026).** Órfão = doc cujo `sync_em` não é o da última rodada da competência (o motor atualiza `sync_em` em todo doc re-listado). Ao caçar o gêmeo, **não basta procurar em `desp_docfin_doc`**: o caso do PC `0003905` (chave 26217, ent 0001669, R$ 22.000, abril, classe 14.08) tinha gêmeo em `desp_realizado_doc` — NFS-e `32` (chave 17290), **mesma entidade, mesmo valor, mesma classe 14.08, mas competência MAIO**. Os R$ 22.000 estavam contados **duas vezes no Hub, em competências diferentes**. Padrão de causa: em contrato recorrente, o Alvo lança o **PC** (compromisso financeiro, espécie PC/RDESP, entra pelo DocFin) e depois a **NFS-e** (fiscal, gera movimento, entra pelo MovEstq). Buscar gêmeo por `(entidade, valor)` **all-dates e nas duas fontes**, nunca só na competência e na tabela de origem.

28. **A limpeza de órfãos é IRREVERSÍVEL — dump prévio é obrigatório em todo backfill (adicionada 20/07/2026, exigida pelo Pedro).** Reabrir competência tem rollback de **status** (`update ... set status='OK'`), mas isso **não desfaz a deleção dos órfãos**. E reprocessar **não os traz de volta**: o doc é órfão justamente porque a listagem atual do Alvo não o inclui — rodar o sync de novo produz o mesmo conjunto sem ele. **A perda é definitiva pelo caminho normal.** Regra: **antes de reabrir qualquer competência com órfãos previstos, dump completo dos docs que serão removidos** (`desp_docfin_doc` inteiro, **incluindo `payload_alvo`**, + todos os `desp_docfin_rateio` deles) em arquivo versionado no repo. **O dump precisa ser verificado, não presumido:** o conteúdo trafega pelo modelo e transcrição não é confiável por inspeção visual — comparar `md5(json::text)` calculado **no banco** contra o `md5` do arquivo local, doc a doc, e só prosseguir com 100% de conferência. Precedente: `backup-orfaos-abril-D001.json` (9 docs / R$ 22.115,57 de rateio, 9/9 md5 conferidos, 186.582 bytes). **Pendente para junho** (31 órfãos / R$ 109.889,94) e para toda competência futura. Restauração = `insert` de volta a partir do JSON, campo a campo.

29. **Existem DUAS classes de esterilização — e a fronteira despesa×custo pode cegar o Hub PROGRESSIVAMENTE (adicionada 20/07/2026).** `25.10` (P&D - SERVIÇOS - ESTERILIZAÇÃO, `incluir_controle=true` desde sempre) e `20.02` (SERVIÇOS - ESTERILIZAÇÃO, produção — era `false`). Mesmo fornecedor, mesmo serviço físico, classes diferentes conforme o produto seja de P&D ou de produção. **Medição (OXIMED 0000143, 12 meses, 84 docs via Load individual): 20.02 = 77 docs / R$ 163.839,39 (92,1%) invisíveis · 25.10 = 7 docs / R$ 14.017,01 (7,9%) capturados.** O sintoma era "8 notas da OXIMED em 2025, zero em 2026" — **não era erro de configuração**: o volume **migrou de P&D para produção** conforme os produtos amadureceram, e o Hub foi cegando sozinho, sem ninguém mudar nada. **Lição generalizável:** classificação estática sobre negócio que evolui produz cegueira crescente e silenciosa. Ao auditar uma classe fora de controle, **procurar a classe irmã** (mesmo serviço, outro estágio do produto) e olhar a **série temporal por fornecedor**, não só o snapshot — a migração entre classes só aparece no tempo. Vale para todo o par 13.x/20.x do D-011.
30. **Em análise MANUAL do DocFin, sempre ignorar `Projecao = 'Sim'` (adicionada 20/07/2026).** O motor de captura já filtra (`Projecao == 'Não'`, regra 6), mas **toda análise manual, export ou passthrough precisa aplicar o mesmo filtro** — projeção é lançamento previsto, não realizado. No export da esterilização, não filtrar teria **inflado o número em ~R$ 18 mil**. Regra: qualquer número tirado do Alvo por fora do motor passa pelos mesmos filtros do motor (filial 1.01 · `Tipo='PAG'` · `Projecao='Não'`), senão não é comparável com o Hub.
31. **`/alvo/passthrough` é a ferramenta de pesquisa no Alvo — investiga sem código novo (adicionada 20/07/2026).** O erp-proxy expõe um passthrough que permite consultar o Alvo diretamente, sem depender de rota nova (portanto **sem deploy e sem violar a regra 11**). Auth por `X-System-Secret`. Já na whitelist: **`DocFin/RetrievePage`** (listar por filtro) e **`DocFin/Load`** (detalhe). Três armadilhas de uso: (a) **`RetrievePage` NÃO traz `DocFinClasseRecDespChildList`** — classe e rateio só vêm no **`Load` individual**, um por documento (é o que torna viável um censo-com-classe sem rota nova, ao custo de N chamadas); (b) o retorno do passthrough é o **array cru do Alvo em `.data`**, sem o embrulho `{count, data}` das rotas normais; (c) aplicar os filtros do motor no consumo (armadilha 30). Precedente: censo OXIMED de 12 meses, 84 Loads, 0 erros.

32. **A limpeza de órfãos roda no CRON, 3×/dia, e apaga sem registro — o dump manual não cobre isso (adicionada 20/07/2026, levantada pelo Pedro).** A armadilha 28 (dump prévio) protege **apenas o backfill manual**. Mas a limpeza é executada em **toda rodada do cron**, sobre as **3 competências da janela rolante**, sem ninguém olhando. A trava de teto barra deleção **em massa**; **deleção pequena (≤25 docs) passa silenciosa e irreversível**. Consequência: as competências da janela rolante estão **permanentemente desprotegidas** — basta uma listagem parcial do Alvo num dia ruim para documentos sumirem sem rastro. **Caso consumado:** rodada de 20/07 15:11 removeu 31 órfãos de junho (R$ 109.889,94) sem dump; hoje é impossível saber quanto era duplicata e quanto era despesa real. **Regra de método (vale além deste módulo): proteção que depende de procedimento humano só cobre o caminho onde o humano está.** Todo caminho automático precisa da proteção embutida no código — foi assim que o D-006 se resolveu (UNIQUE no banco, não disciplina no proxy). Correção especificada em `SPEC-D016-orfaos-auditoria.md` (card **D-016**); enquanto não implantada, **o risco está ativo a cada rodada**.

33. **"Sem contrapartida identificável" é ESTADO DA BUSCA, não conclusão — checklist de 4 verificações antes de declarar perda (adicionada 20/07/2026).** Em junho, o valor declarado como "perda real irrecuperável" caiu **duas vezes seguidas, uma ordem de grandeza cada**: **R$ 39.599,06 → R$ 15.879,91 → R$ 77,06**. Em nenhum momento o dado mudou — mudou o esforço de busca. **Antes de registrar qualquer valor como perda, esgotar as quatro frentes, nesta ordem (barata → cara):**
    * **(a) substituto por chave+valor** — nas **DUAS** fontes (`desp_docfin_doc` e `desp_realizado_doc`), **all-dates** (armadilha 17), por `entidade+valor` com tolerância. O gêmeo costuma ter espécie e número diferentes (PC↔NFS-e, armadilha 27), então a chave estrita do anti-join **não** o encontra.
    * **(b) migração de competência** — o mesmo doc pode ter sido re-emitido em outro mês (caso MICROLUMEN: removido de junho, presente em maio; caso VR(742): `PC 3182` → `20268 - 3182` em julho).
    * **(c) `Projeção = Sim` na origem** — **projeção NUNCA é despesa real**, é ferramenta auxiliar de planejamento do Alvo e o motor a filtra (`Projecao == 'Não'`, regra 6). Versões antigas do código capturaram projeções; elas viram órfãs e são removidas — **e a remoção está certa**. Em junho isso explicou **R$ 15.802,85 de 7 documentos**, ou seja, 99,5% do saldo daquela passada. Só verificável via `Load` no Alvo (armadilha 31).
    * **(d) cancelamento no Alvo** — o doc deixou de existir; remoção correta.
    **Só o que sobrevive às quatro é perda real.** Complementa a armadilha 30 (que trata de projeção em análise manual) com o caso inverso: **projeção que já entrou no banco por captura antiga**. Conferência de saúde: `select count(*) from desp_docfin_doc where payload_alvo->>'Projecao'='Sim'` deve ser **0** (verificado 20/07: 0 em 1.025 docs no DocFin e 0 em 5.139 no MovEstq).

34. **DDL grande com corpo `$$` NÃO vai em bloco `BEGIN...COMMIT` único no SQL Editor — aplicar em partes (adicionada 20/07/2026).** No passo 1 do D-016, o bloco único (tabela + índices + RLS + `CREATE FUNCTION ... $$ ... $$` + `REVOKE`) **abortou inteiro** — tabela e função ficaram em 0. Só funcionou **executando em três partes separadas**: (1) tabela + índices + RLS, (2) a função (corpo `$$`), (3) `REVOKE` + `GRANT`. **O problema não é só a falha: é que o rollback da transação ESCONDE o erro real** — o que se vê é "nada foi criado", não a linha que quebrou. Regra: **DDL com corpo `$$` (function/procedure/do) vai sempre em execução própria**, e cada parte é conferida antes da seguinte. Parente da armadilha 23 (`CREATE OR REPLACE VIEW` só acrescenta coluna no fim): as duas dizem que **DDL neste projeto se aplica em passos pequenos e verificáveis**, nunca num bloco monolítico.
35. **`REVOKE ALL ... FROM public` também revoga do `service_role` — exige `GRANT EXECUTE` explícito depois (adicionada 20/07/2026).** Funções nascem com `EXECUTE` para o pseudo-role `PUBLIC`, e os roles do Supabase (`service_role`, `authenticated`, `anon`) herdam por aí. Portanto `REVOKE ALL ON FUNCTION ... FROM public, anon, authenticated` **derruba também o service_role** — e o motor (proxy/Edge) para de conseguir chamar a RPC, **falhando em produção depois do deploy, não na aplicação do DDL**. Correção aplicada no passo 1 do D-016: acrescentar `GRANT EXECUTE ON FUNCTION ... TO service_role;` e **verificar**, nunca supor: `select has_function_privilege('service_role','public.fn(args)','EXECUTE')`. Conferência do D-016 (20/07): service_role **true**, anon **false**, authenticated **false** — o alvo exato. Vale para **toda RPC nova com escrita** do módulo (a regra do CLAUDE.md manda nascerem `SECURITY DEFINER` com gate; esta armadilha completa: com o **grant certo**).

36. **`.range()` sem `.order()` é paginação INSTÁVEL — e o dano varia de "erro barulhento" a "dupla contagem silenciosa" (adicionada 20/07/2026, achado do Pedro).** Sem `ORDER BY` explícito o Postgres **não garante ordem estável entre páginas**: a mesma linha pode vir em duas páginas, e — pior — **outra pode não vir em nenhuma**. É o mesmo mecanismo diagnosticado como causa raiz do **D-006** (enfileiramento múltiplo por ordenação instável), reaparecendo em outros pontos. **O dano depende de para que serve a lista paginada:**
    * **Lista de chaves para upsert** (ex.: `chavesNoBanco` → `desp_registrar_orfaos`): chave repetida no mesmo lote faz o Postgres abortar com `ERROR 21000: ON CONFLICT DO UPDATE command cannot affect row a second time`. **Falha barulhenta** — ruim, mas visível.
    * **Índice do anti-join** (`carregarIndiceMovEstq`, ~5,1 mil linhas paginadas): **duplicar é quase inofensivo; FALTAR é grave.** Se uma linha do MovEstq não entra no índice, o anti-join conclui "não está no MovEstq" e **ADMITE o documento — dupla contagem, exatamente o que o D-001 existe para evitar**, e sem nenhum erro. Variante secundária: se a detecção de colisão contar *entradas* em vez de *valores distintos*, chave duplicada vira falso `REVISAO_COLISAO` e deixa de admitir doc legítimo.
    **Regra: toda paginação `.range()` leva `.order()` por coluna única e estável** (`chave_docfin`, `chave_movestq`, `id`) **antes** do `.range()`. Vale para as duas rotas do proxy e para qualquer Edge Function. **Defesa em profundidade** onde o consumo permitir: dedupar também no destino (a RPC `desp_registrar_orfaos` faz `DISTINCT ON` e devolve `duplicadas_no_lote` — um contador > 0 **acusa a paginação instável na origem**). Auditoria pendente: card **D-018**.

\---

## 5\. Concluído (histórico)

* **15/07/2026 — D-010 CONCLUÍDO (Versão A):** etapa 3 no ar nas duas rotas do proxy (`em_controle` explícito no insert); etapa 3b cancelada após a auditoria das 144 classes provar que o filtro atual está correto; crons reativados; invariante `valor_fora_controle = R$ 0,00` de pé. Total do Hub: **R$ 32.074.526,98**.
* **14/07/2026 — D-006 fechado:** 16 grãos duplicados removidos de abril (R$ 22.203,47, delta ao centavo) + `uq_desp_docfin_rateio_grao` criada. O `ALTER` validou a tabela inteira e passou → provou que abril era a **única** competência corrompida.
* **14/07/2026 — Anti-join do D-001 em produção:** o proxy substituiu o filtro `Origem=Estoque` pelo anti-join real contra `desp_realizado_doc` (chave + valor + guarda de colisão, all-dates, índice paginado em memória). Smoke de maio: **59 admitidos = exatamente o previsto**, 0 dupla contagem. **Ainda falta o backfill jan–jun.**
* **14/07/2026 — Etapa 1 do D-001 re-auditada:** vazamento revisado de 391/R$ 2,12M para **371 docs / R$ 1.475.637** após o anti-join real substituir a dedução `origem_alvo` (armadilha 19). Evitou R$ 612.770,92 de dupla contagem.
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
|15/07/2026|**D-010 etapa 2 APLICADA e validada** (view+RPCs): contagem de linhas idêntica (6.151), `valor_fora_controle` exposto, validação pela TELA (o SQL Editor cai no `_is_admin()`). **Incidente:** o total caiu R$ 648.963,95 logo após — causa: 41 rateios gravados pelos syncs entre o DDL e a etapa 3 nasceram com `em_controle` no DEFAULT `false`. Corrigido por UPDATE; invariante restaurado. **O `DEFAULT false` provou seu valor** (erro apareceu na direção segura) → **armadilha 25**|Pedro + Claude|
|15/07/2026|**D-010 etapa 3 APLICADA** — `despesas.ts` e `docfin-despesas.ts` passam a setar `em_controle: true` explícito no insert. Smoke das duas rotas com movimento real (MovEstq 17/07: 17 docs/19 rateios; DocFin maio: 97 docs/102 rateios). Invariante `fora=R$ 0,00`. **Crons reativados** após 2 dias pausados|Pedro + Claude|
|15/07/2026|**Auditoria das 144 classes fora do controle (Pedro):** nenhuma é despesa que deveria ser controlada (receita, NF sem valor financeiro, devolução, reembolso, adiantamento, sintéticos, custo de produção, ativo). **O filtro atual está CORRETO — não havia cegueira, havia filtro.** → **D-008 FECHADO**, **D-010 etapa 3b CANCELADA**, criado card **D-011** (fronteira despesa × custo de produção: 13.x e 20.x são consumidos, não estocados)|Pedro + Claude|
|15/07/2026|**Armadilha 24** (`data_competencia` é NULL na maior parte da base — recorte temporal usa `ano`/`mes` do rateio; uma query filtrando por ela mostrou R$ 10,7M de R$ 31,8M reais) e **armadilha 25** (`DEFAULT false` em flag de inclusão financeira, validada empiricamente pelo incidente dos R$ 648k)|Pedro + Claude|
|20/07/2026|**Bug encontrado pelo Pedro na revisão da RPC — chave duplicada no lote.** Se `p_linhas` contiver a mesma chave 2×, o `ON CONFLICT` aborta com `ERROR 21000: cannot affect row a second time`. **Caminho concreto:** a paginação que monta `chavesNoBanco` usa `.range()` **sem `.order()`** — **o mesmo mecanismo diagnosticado como causa raiz do D-006**, reaparecendo em outro ponto. Corrigido em profundidade: **(a)** `DISTINCT ON` na RPC + campo `duplicadas_no_lote` no retorno (vira **detector** da instabilidade na origem) · **(b)** `.order()` antes do `.range()` no proxy. **Teste V5** acrescentado (mesma chave 2× ⇒ `{"inseridos":1,"duplicadas_no_lote":1}` em vez de erro). **Armadilha 36** (`.range()` sem `.order()` é paginação instável; o dano vai de erro barulhento a **dupla contagem silenciosa** no `carregarIndiceMovEstq`) e card **D-018** (auditoria das duas rotas). **Consequência registrada:** a simulação dos 66 admitidos de abril rodou em SQL direto, sem paginação — se `antijoin_admite ≠ 66`, **investigar a paginação antes da lógica de admissão**|Pedro + Claude|
|20/07/2026|**D-016 passo 2 — decisão do Pedro: usar a RPC `desp_registrar_orfaos`, não o `.upsert()` simples.** Razão (mais forte que a do agente): o `n_deteccoes` travado é o menor problema — **o grave é o `status` voltando para `DETECTADO`, que apaga decisão humana**; um órfão marcado `IGNORADO` seria revertido em silêncio e o mesmo caso reanalisado para sempre. Mesma família do problema que o D-016 resolve. E sem urgência, já que "nunca apagar por padrão" estanca a sangria assim que o passo 2 subir — fazer simples significaria mexer no proxy duas vezes. DDL em `SPEC-D016-passo2-rpc.sql` (3 partes — armadilha 34 — com GRANT — armadilha 35 — e teste **V3 que prova a preservação do `IGNORADO`**). **Preservados no `ON CONFLICT`:** `status`, `primeira_deteccao_em`, `removido_em/por`, `restaurado_em`, `tem_gemeo`, `gemeo_fonte`, `gemeo_ref`, `observacao`. Criado **D-017** (retenção do `doc_json`)|Pedro + Claude|
|20/07/2026|**D-016 PASSO 1 APLICADO E VERIFICADO (Pedro).** `desp_docfin_orfaos` criada (0 linhas, RLS ativo, 0 policies, 5 índices) + RPC `desp_remover_orfaos_verificado` (`SECURITY DEFINER`=true; grants conferidos: service_role **true**, anon **false**, authenticated **false**). **V4 — a guarda LEVANTOU EXCEÇÃO** (`P0001: D016: 1 chave(s) sem snapshot - remocao abortada: {999999999}`), **não retornou zero silencioso**: o invariante está de pé. Artefato `SPEC-D016-passo1.sql`. **Duas armadilhas nasceram da execução: 34** (DDL grande com corpo `$$` não vai em `BEGIN...COMMIT` único — o bloco abortou inteiro e o rollback **escondeu o erro real**; só funcionou em 3 partes) e **35** (`REVOKE ALL ... FROM public` revoga também do **`service_role`** — exige `GRANT EXECUTE ... TO service_role` explícito e **verificação** com `has_function_privilege`, senão o motor quebra em produção depois do deploy, não na aplicação do DDL). **Passo 2 especificado** em `SPEC-D016-passo2.md`|Pedro + Claude|
|20/07/2026|**CORREÇÃO FINAL de junho (Pedro, via `DocFin/Load`): a perda real é R$ 77,06, não R$ 15.879,91.** 7 dos 8 documentos restantes são **`Projeção = Sim`** (R$ 15.802,85) — projeção nunca é despesa, o motor filtra `Projecao='Não'`, eram resíduo de versão antiga do código: **a remoção estava CERTA**. Sobra 1 doc: PRO LAB chave 28773, R$ 77,06. O "8 onde havia 7" é **outro caso do D-013** (PRO LAB tem 2 chaves com o mesmo número: 28772 R$ 1,39 + 28773 R$ 77,06 = os R$ 78,45). Verificado por leitura: **0 projeções remanescentes** (1.025 docs DocFin e 5.139 MovEstq, todos `Projecao='Não'`). **Sequência: R$ 39.599 → R$ 15.879 → R$ 77,06 — duas vezes seguidas "sem contrapartida" era estado da busca, caindo uma ordem de grandeza por passada.** → **armadilha 33** (checklist de 4 verificações antes de declarar perda: substituto / migração / projeção / cancelamento). **A justificativa empírica do D-016 foi corrigida na spec e no card — honestamente, sem esconder** — mas o card **permanece** pelo argumento estrutural: o ponto não é o tamanho da perda, é que deleção sem registro torna a investigação impossível (chegar ao R$ 77,06 custou meia hora de `RetrievePage`+`Load`; com a quarentena seria um select)|Pedro + Claude|
|20/07/2026|**Quebra por CLASSE do oculto (D-011) — a pergunta de escopo respondida:** extraído de `DocFinClasseRecDespChildList` / `MovEstqClasseRecDespChildList`, as classes que não viraram rateio. **NENHUMA com `classificacao='despesa'` — zero. Não há bug de configuração, não há urgência técnica.** Composição: custo 51,8% · **ativo 44,9%** · receita 3,3%. Maiores: **24.01 máquinas/equipamentos R$ 85.851,81** (ACURATE — responde com número o item 3 do D-001-A1: imobilizado **não** entra em despesa) · **12.01 frete de MP R$ 42.063,90** (amarrado ao Backlog Fase 2) · **13.01 EPI/paramentação R$ 33.231,37** (o exemplo escrito no próprio D-011). **20.02 não aparece porque o Pedro a ligou hoje**; as irmãs 20.03/20.04/20.05 somam R$ 15.167,90 e seguem ocultas. Extrapolação anual **registrada como observação com ressalva, não como estimativa** (2 competências, ambas com anti-join recente)|Pedro + Claude|
|20/07/2026|**D-016 APROVADO — código entregue** (`SPEC-D016-codigo.md`): DDL de `desp_docfin_orfaos` + RPC `desp_remover_orfaos_verificado` (atomicidade no banco, guarda que aborta se qualquer chave estiver sem snapshot) + TypeScript do proxy + RPC de restauração + queries de conferência. **Implantar ANTES do backfill de abril** — argumento do Pedro: sem a limpeza, o delta de abril vira **puramente positivo** e o critério cai de 3 para 2 parcelas|Pedro + Claude|
|20/07/2026|**Corolário do D-007 rodado — piso da despesa invisível (insumo do D-011):** DocFin **R$ 158.780,83** + MovEstq **R$ 25.206,94** em 2026. **Padrão revelador: gap do DocFin é ZERO em jan–abr e explode em mai (R$ 52.651,66) e jun (R$ 105.828,72)** — as competências com anti-join; docs de classe mista só existem no banco depois do D-001. **Previsão registrada: o backfill de jan–abr vai aumentar esse número.** Maiores: NF-e ACURATE R$ 83.783,54 · DIV ALSCO R$ 26.114,37 · série DHL/FEDEX (frete internacional, entra só pela 09.04). Instrumento é **piso**: não vê o doc descartado por inteiro|Pedro + Claude|
|20/07/2026|**D-015 revisado — a fatia "sem substituto" caiu 60%** (R$ 39.599,06 → **R$ 15.879,91**) após o Pedro apontar que a busca parou cedo. O PC de R$ 19.800 era **BIOCOLLAGEN** (NF-e 1563 no MovEstq); mais 7 substitutos achados. Fechamento exato: substituição R$ 81.337,48 + duplicata R$ 24.747,55 + migração R$ 7.725 + sem-substituto R$ 15.879,91 = R$ 129.689,94. **Lição: "sem substituto identificável" não é conclusão, é estado da busca.** Restam 7 docs para `DocFin/Load` no Alvo|Pedro + Claude|
|20/07/2026|**D-015 CONCLUÍDO — decomposição de junho fecha ao centavo:** (a) admitidos **+27 docs / +R$ 113.802,88** · (b) órfãos removidos **−32 docs / −R$ 129.689,94** · líquido **−5 / −R$ 15.887,06** ✅. Foram **32** removidos, não 31 (um PC de R$ 19.800 virou órfão na própria rodada — órfãos são gerados continuamente). **A parcela (b) tem 4 sabores:** substituição PC→NFS-e R$ 57.618,33 (VR BENEFÍCIOS PC 4234 = NFS-e 98084371 + 98084370, soma exata, ambas admitidas na mesma rodada) · duplicata de documento R$ 24.747,55 (D-013) · migração de competência R$ 7.725 · **sem substituto R$ 39.599,06 — apagados sem dump, irrecuperáveis**. ~70% da remoção tem contrapartida: **líquido negativo ≠ perda de despesa**|Pedro + Claude|
|20/07/2026|**D-007 FECHADO** — o resíduo de R$ 300,45 é **um documento**: RDESP `20032026` (chave 27368) OPENAI, doc R$ 319,98 com rateio de apenas R$ 19,53 (classe 09.04); o resto está em classe fora de controle. Não era bug nem arredondamento: é a **cegueira de classe do D-008/D-011 manifestada como resíduo de conciliação**. Corolário: `valor_documento − sum(rateio)` por doc é um **medidor barato da despesa invisível** em docs de classe mista — instrumento para o D-011|Pedro + Claude|
|20/07/2026|**Risco sistêmico levantado pelo Pedro → armadilha 32 + card D-016 + `SPEC-D016-orfaos-auditoria.md`.** O dump da armadilha 28 protege só o backfill manual; a limpeza roda no **cron, 3×/dia, sobre a janela rolante**, e apaga sem registro — deleção ≤25 docs passa silenciosa e mai/jun/jul estão permanentemente desprotegidas. Spec entregue: tabela `desp_docfin_orfaos` (quarentena com `doc_json`+`payload_alvo`, gravada **na detecção** e na **mesma transação** da deleção). **Recomendação do agente: o motor NUNCA apaga por padrão — nem cron nem manual — remoção exige flag explícita**, por assimetria do erro (apagar errado é invisível, não apagar é visível). Regra de método: *proteção que depende de procedimento humano só cobre o caminho onde o humano está*|Pedro + Claude|
|20/07/2026|**D-001 EM PRODUÇÃO — 1ª rodada real (Pedro).** O cron das 15:11 reprocessou junho com o código novo e admitiu espécies-alvo pela 1ª vez (NF-e 29434 ACURATE R$ 103.344,87 · CT-e 29433/29432 · NFS-e 29078 · NFCom 29057). Junho 243 → **238 docs**, R$ 1.434.526,06 → **R$ 1.418.639,00** (−R$ 15.887,06 líquido). Total do Hub: **R$ 32.058.639,92**, `valor_fora_controle` = R$ 0,00. **Escopo do backfill REDUZIDO de 6 para 4 competências** (mai/jun/jul já rodaram pela janela rolante) — §6 da `SPEC-D001-erp-proxy.md` atualizada. Criado **D-015** (decompor os −R$ 15.887,06 nas 3 parcelas, usando `censo-jan-jun.json`)|Pedro + Claude|
|20/07/2026|**D-011 RESOLVIDO para esterilização, com número MEDIDO (Pedro).** Censo via `/alvo/passthrough` (RetrievePage + **Load individual de cada doc**), entidade OXIMED 0000143, 12 meses, **84 docs, 0 erros, 0 pulados** (`oximed-12m.csv`): **20.02 = 77 docs / R$ 163.839,39 (92,1%) INVISÍVEIS** · 25.10 = 7 docs / R$ 14.017,01 (7,9%) capturados. **Escritas do Pedro no rito:** de-para 20.02 → `5.3.01.005.009` (Beneficiamento de Terceiros) em `desp_classe_conta` + `incluir_controle=true` na 20.02 — captura futura resolvida, conferido por leitura. Histórico exige re-sync do MovEstq → card **D-014** (~250 dias úteis, watchdog corta em 80s, precisa de plano de lotes). **Armadilhas 29** (duas classes de esterilização; o volume migrou de P&D para produção e o Hub cegou progressivamente — não era erro de config), **30** (análise manual do DocFin sempre ignora `Projecao='Sim'`; teria inflado o número em ~R$ 18 mil) e **31** (`/alvo/passthrough` como ferramenta de pesquisa: RetrievePage não traz classe, só o Load; retorno é array cru em `.data`)|Pedro + Claude|
|20/07/2026|**Dump de segurança dos 9 órfãos de abril** (`backup-orfaos-abril-D001.json`, 186.582 bytes, 9/9 md5 conferidos contra o banco) — exigido pelo Pedro ao apontar que o rollback de status **não** desfaz a limpeza e que reprocessar não recupera órfão. **Armadilha 28** (limpeza de órfãos é irreversível; dump verificado por md5 é pré-requisito de todo backfill). Rateio dos 9 = **R$ 22.115,57** (não R$ 22.416,02, que é valor de documento). Gêmeo confirmado doc a doc: **1 de 9** (PC 26217 ↔ NFS-e 32 do MovEstq, R$ 22.000, classe 14.08 nos dois lados) — os 8 RDESP (R$ 115,57) **não têm gêmeo** em nenhuma das duas fontes|Pedro + Claude|
|20/07/2026|**Abertura do backfill jan–jun (leitura).** Simulação do anti-join reproduz a §6 da spec **exatamente** nas 6 competências contra o MovEstq de hoje (abril = 66 / R$ 385.703,43). Censo de órfãos: jan–mar 0 · abr 9 · mai 49 · jun 31. **Correção de fato:** a conversão do smoke de maio era R$ 6.362 mas é **R$ 588,69** — os R$ 5.773,30 restantes são um DIV de captura antiga (sync 18/06, órfão do D-009) contado como ganho do D-001 → card **D-012**. Achados: **armadilha 26** (a trava de órfãos APAGA por padrão; só aborta acima de max(25; 30%) — maio foi exceção) e **armadilha 27** (gêmeo de órfão pode estar na outra fonte e em outra competência: PC 26217 abril = NFS-e 32 MovEstq maio, R$ 22.000 contados 2×). Card **D-013** (duplicação de DOCUMENTO, que o UNIQUE do D-006 não cobre) — **bloqueia o backfill de junho**|Pedro + Claude|
|14/07/2026|**D-010 etapa 1 (schema) APLICADA** — coluna `em_controle` (default false) + backfill + trigger `desp_sync_em_controle`; verificado 1070/1070 + 5940/5940, migração neutra (R$ 31.831.095,41). Etapa 2 (view+RPCs): DDL pronto em `SPEC-D010-etapa2.sql`(+rollback), aguardando aplicação. **Armadilha 23** (`CREATE OR REPLACE VIEW` só acrescenta coluna no fim)|Pedro + Claude|

\---

## 7\. Referências rápidas

**Arquitetura:** Lovable (browser, JWT) e pg\_cron → Edge Functions (Deno, `X-System-Secret`) → erp-proxy (Render, riosoft-token cache 25min) → Alvo ERP (`pef.it4you.inf.br/api`, filial 1.01).

**Supabase:** projeto `hbtggrbauguukewiknew` · **Repo:** GitHub `financeiropfbrazil/finances-pf` (auto-deploy Lovable; Edge Functions via Supabase CLI).

**Tabelas:** `desp\_docfin\_doc/rateio` · `desp\_realizado\_doc/rateio` · `desp\_docfin\_competencias` · `desp\_dias\_capturados` · `desp\_classe\_config` (267 classes, 123 em controle) · `desp\_plano\_contas` · `desp\_classe\_conta` · `desp\_competencia\_status`.

**RPCs:** `desp\_set\_conta\_classe` · `desp\_recarimbar` · `desp\_fechar\_competencia` · `desp\_reabrir\_competencia` · `desp\_listar\_depara` · `desp\_listar\_plano\_resultado` · `desp\_listar\_competencias`.

**Arquivos-fonte:** frontend `src/pages/despesas/ConfigContasDespesas.tsx`, `src/services/deparaContabilService.ts`, `src/components/AppSidebar.tsx` · Edge `supabase/functions/sync-despesas-cron/index.ts`, `sync-docfin-cron`.





Dois repos, um módulo. finances-pf = frontend Lovable + Edge Functions (deploy: git push → Lovable; CLI → Supabase). erp-proxy = gateway do Alvo, onde vivem RetrievePage, autenticação riosoft-token e a lógica de descarte Origem=Estoque (deploy: manual no Render, pelo Pedro — **o agente nunca toca o erp-proxy: nem lê o repo, nem escreve código, nem deploya; só entrega especificação funcional**, conforme armadilha 11). Toda correção de captura (D-001, D-001-A1) é código do erp-proxy, não do finances-pf.

