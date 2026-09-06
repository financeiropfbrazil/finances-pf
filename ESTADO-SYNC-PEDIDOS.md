# ESTADO-SYNC-PEDIDOS.md — missão Sync de Pedidos

> Estado **próprio** desta missão. Independente da missão *Aprovação de Requisições*
> (`ESTADO-APROVACAO-REQ.md`) — não escrever lá, não ler de lá.
> Documentos da missão: `MISSAO-SYNC-PEDIDOS.md` (espec-mãe) · `PROMPT-S0-SYNC-PEDIDOS.md`
> (substitui a §4 da espec) · `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` (achados, revisão 2).

**Criado em:** 03/09/2026 · **Última atualização:** 06/09/2026 (deploy da S1.1)

---

## 1. Situação em uma linha

A correção do sync (**FASE S1**) **já foi ao ar** entre 20 e 24/08 e funciona. A **S1.1** corrigiu o
gate que barrava 122 pedidos e instrumentou as execuções órfãs — **publicada em 06/09/2026**, ainda
**sem ciclo real** (o primeiro é segunda 08/09 08h00 BRT — ver §10.4). Restam **1.174 pedidos /
R$ 12,19 M** sem rateio normalizado para o backfill, cujo desenho mudou: o jsonb sozinho **não
basta** (9,5% está desatualizado — §5.1).

---

## 2. Fases

| Fase | Estado | Observação |
|---|---|---|
| **S0 — Discovery** | ✅ **concluída** (rev. 1 em 14/08, rev. 2 em 03/09) | `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` |
| **S1 — Correção do sync** | ✅ **em produção desde 20–24/08** (cards C3, C3.2, C3.3, D4) | **Não foi executada por esta missão** — chegou pela trilha de Suprimentos. Ver §4 |
| **S1.1 — Gate + instrumentação** | 🟡 **publicada em 06/09/2026, aguardando 1º ciclo** | Deploy confirmado (v50, `BUILD_TAG` S1.1). Efeito só é observável na 2ª-feira 08/09. Ver §9 e §10.4 |
| **S2 — Backfill** | 🔴 **aberto — desenho a revisar** | A pré-condição §5.1 reprovou parcialmente: o jsonb é fiel mas **desatualizado em 9,5%**. Ver §10 |
| **S3 — Convenção de percentual** | 🔴 aberto | T4 do Ajuste |

---

## 3. Números de referência (medidos 03/09/2026, 09h23 BRT)

| Métrica | Valor |
|---|---:|
| `compras_pedidos` | 2.017 |
| `compras_pedidos_itens` | 3.495 |
| `compras_pedidos_itens_rateio` | 863 linhas / 796 itens |
| Itens cuja soma de `percentual` ≠ 100 | **2** (convenção, não corrupção — S0-3) |
| Duplicatas (item, classe, CC) | **0** |
| Pedidos sem rateio normalizado, com rateio no jsonb | **1.174** · **R$ 12.190.349,64** |
| …deles, **elegíveis ao Job 2 mas barrados pelo gate** | **121** · R$ 1.809.107,94 |
| Pedidos que o gate corrigido dispara (inclui 1 nascido no Hub) | **122** — ver §9.2 |
| …deles, fora da fila do Job 2 | **1.053** · R$ 10.381.241,70 |
| …deles, de **2026** (recorte S3) | **922** |
| …deles, com o rateio **já no jsonb `itens`** (backfill sem Alvo) | **1.173 de 1.174** |
| …deles, **sem itens normalizados** (precisam de carga de item) | 77 |
| Valor 2026 **sem** rateio normalizado | **R$ 14.763.599,73 (78,5%)** |
| Fila do Job 2 (elegíveis) | ~421, **estável/caindo** (−2,7/dia) |
| Cobertura de rateio, coorte ago/set 2026 | **72%** (era 14,3% em 14/08) |

### Âncora anti-wipe (regra 11) — ✅ **recongelada (decisão T3, 03/09)**

| | |
|---|---:|
| **Âncora vigente** | **R$ 2.739.015,00 · 228 pedidos · agosto/2026** |
| Âncora anterior (aposentada) | R$ 1.642.742,28 · 92 pedidos |

**Por que a troca.** A anterior foi medida em **12–14/08, com agosto ainda em curso** — media um mês
incompleto e, por construção, mudaria sozinha até 31/08 sem que nada estivesse errado. Usá-la como
invariante depois do fechamento acusaria falso positivo em qualquer validação do S2. A nova mede
**agosto fechado**, e o mês não recebe mais pedido novo com `data_pedido` de agosto.

⚠️ **Nem o recorte "agosto até 14/08" reproduz a âncora antiga** (dá R$ 1.583.976,69 / 87). A
diferença não é erro: o Job 2 propaga o `ValorTotal` do Alvo, então valores de agosto **mudaram
legitimamente** entre 14/08 e o fechamento. Isso confirma que a âncora tinha de ser trocada, não
recalculada.

**Consulta de conferência** (repetir antes e depois de cada lote do S2):
```sql
select count(*) pedidos, round(sum(valor_total)::numeric,2) total
from compras_pedidos
where data_pedido >= date '2026-08-01' and data_pedido < date '2026-09-01';
-- esperado: 228 | 2739015.00
```

---

## 4. O que mudou fora desta missão (e por que importa)

A missão foi especificada em 14/08. Entre 14/08 e 03/09 entraram **114 commits** no `main`, e a
correção que a §5 pedia foi implementada pela trilha de Suprimentos:

| Commit | Data | Card |
|---|---|---|
| `050e88f` | 20/08 | C3 — cron grava rateio por item, parcelas e completa cabeçalho |
| `105e1fb` | 20/08 | C3.2 — percentual de classe única ausente + gate de reprocesso |
| `d767457` | 24/08 | C3.3 — normalização: null≠zero, tolerância, reconstrução por valor |
| `ff1dd86`, `7d7afb1` | 27–28/08 | D4 — consolidação de (classe, CC) repetido |

### 4.1 Lição de método — especificação envelhece, e envelhece calada

O `PROMPT-S0` foi **escrito em 03/09 a partir de medições de 14/08** e apresentava como trabalho
futuro uma correção que já estava em produção havia duas semanas. Nada no documento sinalizava isso:
os números eram reais, as citações de código eram reais, e as linhas citadas até existiam — em outro
lugar do arquivo, porque o cron tinha sido reescrito no intervalo.

**O que torna o caso perigoso** é que executar a espec ao pé da letra teria *funcionado*: eu teria
reimplementado `persistirItensPedido`, o build passaria, e o resultado seria código duplicado por
cima de código vivo, num arquivo de 2.760 linhas que roda em produção 10 vezes por dia.

**Regra que fica:** medir o estado atual **antes** de implementar, mesmo quando a especificação é
recente e detalhada — sobretudo quando é. Custo: dois `git log` e três queries. Concretamente:

1. `git log --since=<data da medição> -- <arquivo alvo>` antes de tocar em qualquer arquivo citado.
2. Refazer a medição-chave da espec (aqui: contar as linhas de rateio) e comparar com o número dela.
3. Se divergir, **parar e reportar** — a espec descreve outro sistema.

Esta missão e a trilha de Suprimentos trabalharam no mesmo arquivo sem que os documentos se
cruzassem. **Um escritor por vez vale para o repo; não valeu para os planos.**

---

## 5. Decisões do Pedro (herdadas da espec, 14/08)

| # | Tema | Decisão | Estado |
|---|---|---|---|
| S1 | jsonb × normalizado | gravar os dois na transição | ✅ implementado (dual-write no card C3) |
| S2 | `cnpj_entidade` / `nome_entidade` | voltar a escrever, com fallback | ✅ implementado (`completarCamposAusentes`) |
| S3 | Backfill | só ano corrente (2026) | ⏳ aplica-se a 922 dos 1.174 |
| S4 | Escopo da auditoria | ampliado, todos os campos | ✅ matriz §4.2 do Discovery |
| S5 | Ordem | corrigir, provar, depois backfill | ✅ satisfeito — o S1 está provado em ciclo real |

---

### 5.1 Decisões do Pedro de 03/09 (Ajuste S1.1)

| # | Tema | Decisão | Estado |
|---|---|---|---|
| T1 | Backfill | **SQL puro** sobre payload persistido | ⚠️ **condicionado** — ver §10: o jsonb sozinho não basta |
| T1-a | Pré-condição | provar em amostra que o jsonb bate com o Load | 🟡 **parcialmente reprovada** — ver §10 |
| T2 | Os 121 barrados | **corrigir o gate, antes do backfill** | ✅ código pronto (§9), aguardando deploy |
| T3 | Âncora | recongelar em R$ 2.739.015,00 / 228 | ✅ aplicada (§3) |
| T4 | Dupla convenção de percentual | `COMMENT` é o mínimo; avaliar normalizar | 🔴 aberto (fase S3) |
| T5 | Chave única do rateio | **não criar** | ✅ respeitado — nenhum índice criado |

---

## 6. Bloqueios abertos

| # | Pergunta | Bloqueia |
|---|---|---|
| 1 | 🔴 **Fonte do backfill**, agora que o jsonb mostrou 9,5% de desatualização: usar `resposta_alvo` da auditoria quando existir (cobre 508) e jsonb no resto (666), ou fazer Load ao vivo dos 666? | desenho do **S2** — ver §10 |
| ~~2~~ | ✅ **Fechado em 06/09** — o CHECK de `compras_requisicoes_auditoria` **já contém** `descoberta_alvo` e `sync_status`: o DDL foi aplicado em 03/09, entre o commit (10h21) e as 16h00. Verificado por `pg_get_constraintdef` + 1 linha `descoberta_alvo` gravada às 16h00. Nada a fazer no deploy | — |
| ~~3~~ | ✅ **Fechado em 06/09** — deploy feito no domingo, fora da janela `1-5` | — |
| 4 | A **dupla convenção de `percentual`** fica como está, ganha coluna, ou ganha `COMMENT`? | fase **S3** |

As demais perguntas (5 a 12) estão em `DISCOVERY-SYNC-RATEIO-PEDIDOS.md`, seção final.

---

## 7. Riscos vivos

| # | Risco | Evidência |
|---|---|---|
| R1 | 🔴 `percentual` com **duas semânticas** na mesma coluna, não declaradas no schema. Consulta nova que some percentual erra por um fator = nº de classes | incidente de 27/08: R$ 191 mil de valor fantasma na tela |
| R2 | 🔴 O **escopo do líder de CC** (AJUSTE 7.2, entregue 02/09) lê a tabela de rateio **e** o cabeçalho. Com 78,5% do valor sem rateio, apoia-se na *primeira fatia* | `listar_pedidos_escopo` lê as duas fontes |
| R3 | ⚠️ Falha de RPC no rateio **reabre a flag** e o pedido volta — se a forma nova do Alvo for sempre recusada, vira **laço infinito** | 4 pedidos, 20–24/08, resolvidos pelo C3.3 |
| R4 | ⚠️ Execução do cron pode **morrer no meio** sem contar erro (`finished_at` nulo) — invisível a alarme por `total_erros` | 2 casos: 24/07 08:00, 02/09 17:00 |
| ~~R5~~ | ✅ **Extinto em 06/09** — a publicada é `7b4214b` e leva `f7185bf` + `11cbe2b` junto, como previsto. `BUILD_TAG` publicado = repo | v50, §10.4 |
| R6 | ⚠️ `paused_at` em `sync_settings` **não é lido** pela função; a linha de hoje tem carimbo de 26/05 com `enabled=true` — quem olhar a tabela conclui errado | `index.ts:2597` lê só `enabled` e `paused_reason` |

---

## 8. Operacional

- **Janela do cron:** `0 11-20 * * 1-5` = **08h–17h BRT, dias úteis**, 10 execuções/dia (jobid 1).
  Janela segura de deploy: **após 17h BRT ou fim de semana**.
- **Kill-switch:**
  ```sql
  update sync_settings set enabled = false, paused_reason = '<motivo>'
  where job_name = 'sync-compras-status-cron';
  -- reverter: set enabled = true, paused_reason = null
  ```
  A pausa **não impede o disparo** — a função sobe, registra um `sync_run` e sai.
- **O Alvo não responde à noite.** Falhas de 26/08 foram todas após as 18h. Não rodar sync manual
  fora do horário comercial.
- **Rollback do Discovery:** `git show 0dce7cb:DISCOVERY-SYNC-RATEIO-PEDIDOS.md` (versão de 14/08).

---

## 9. S1.1 — o que está pronto e o que falta (deploy)

### 10.1 O que o código passou a fazer

**(a) Gate de reprocesso por evidência direta** (`syncPedidos`, Job 2).
Antes, os três jsonb (`classe_rateio`, `parcelas`, `itens`) eram o **proxy** que decidia se os
filhos relacionais faltavam. Na geração antiga o proxy é falso-positivo: o loader antigo populou os
jsonb quando a tabela de rateio nem era destino do sync. Agora a decisão usa os dois lados reais:

| lado | evidência | como |
|---|---|---|
| Alvo | o ERP tem rateio de item para este pedido? | `extrairRateiosDoItem(alvo)` sobre o payload **já em mãos** — o Load acontece para todo candidato |
| Hub | a tabela relacional tem linha? | `carregarPedidosComRateio`, 2 leituras por ciclo, em blocos |

Reprocessa só quando **o Alvo tem e o Hub não tem**.

⚠️ **A conjunção não é preciosismo.** Medido: **7 pedidos elegíveis não têm rateio em lugar
nenhum**. Com um gate `!temRateioNoHub` sozinho, eles entrariam em reprocesso todo ciclo, todo dia,
sem nunca poder ser satisfeitos — o laço infinito que o C3.2 já produziu uma vez. Perguntando ao
payload primeiro, "não tem rateio lá" encerra o assunto.

**Fallback (regra 10):** se a leitura do Hub falhar, `ok:false` desliga o critério **naquele ciclo**
e loga alto. Nunca conclui "ninguém tem rateio" — isso mandaria o lote inteiro (100 RPCs) para
reprocesso por causa de uma leitura falha.

**(b) Execução órfã deixa de ser invisível** (handler principal).
A linha de `sync_runs` é aberta no início e fechada no fim; execução que morre no meio ficava com
`finished_at` null, `total_erros` 0 e `observacao` null — **invisível a qualquer alarme por
`total_erros > 0`**. Agora cada execução carimba as órfãs anteriores (corte de 30 min,
idempotente por `observacao is null`). `finished_at` **continua null de propósito**: a execução não
terminou, e inventar horário de término seria mentir sobre o fato.
Medido: **3 órfãs** — 19/06 15:00, 24/07 08:00, 02/09 17:00 (o Discovery tinha achado 2).

### 10.2 Impacto do deploy, medido antes

| | |
|---|---:|
| Elegíveis ao Job 2 (como o cron conta) | **415** |
| Pedidos que o gate novo passa a disparar | **122** |
| Elegíveis sem rateio em lugar nenhum (**não** disparam) | 7 |
| **Chamadas extras ao Alvo** | **zero** — o Load já acontece para todo candidato |
| Trabalho extra | 1 RPC + 1 upsert de itens por pedido disparado |
| Ritmo | 100/execução × 10 execuções/dia sobre 415 elegíveis ⇒ varredura completa em ~4 execuções |
| Prazo para drenar os 122 | **~meio dia útil**, decrescendo (pedido corrigido para de disparar) |

**Não há risco de enfileiramento:** a fila não cresce (é população elegível, não backlog), o custo
marginal é uma RPC transacional por pedido, e as execuções levam hoje 43–115 s.

### 10.3 Pré-requisitos do deploy — ✅ **cumpridos em 06/09/2026** (registro em §10.4)

1. ✅ **`docs/SQL-S1.1-CHECK-AUDITORIA-REQ.sql`** — já estava aplicado desde 03/09; nada a decidir.
2. ✅ **Janela:** domingo 06/09, fora do `1-5`.
3. ✅ **Deploy:** `supabase functions deploy sync-compras-status-cron --project-ref hbtggrbauguukewiknew`.
4. ✅ **Confirmado que a função responde** — `BUILD_TAG` publicado é
   `S1.1-GATE-EVIDENCIA-DIRETA + ORFAS (2026-09-03)`.
5. 🟡 **Um ciclo real** — pendente: primeiro é **segunda 08/09 08h00 BRT**. Conferir `sync_runs` e a
   queda do número de barrados (§10.4).
6. **Âncora de agosto inalterada:** R$ 2.739.015,00 / 228.

⚠️ **A Edge Function não pôde ser compilada localmente** — `deno` não está instalado nesta máquina, e
`tsc -p tsconfig.app.json` (que passou) **não cobre `supabase/functions/`**. O `bun run build` também
não a inclui. A compilação real acontece no `functions deploy`. Revisei as três regiões editadas à
mão; o risco residual é de tipo, não de lógica.
→ **Resolvido pelo próprio deploy de 06/09:** o bundle é montado no servidor e subiu sem erro; o
risco de tipo não se materializou.

### 10.4 Registro do deploy — 06/09/2026 (domingo), 07h40 BRT / 10h40 UTC

Commit publicado: **`7b4214b`** (leva junto `f7185bf` e `11cbe2b`, como previsto na R5).
Comando: `supabase functions deploy sync-compras-status-cron --project-ref hbtggrbauguukewiknew`.
Sem Docker e sem `deno` local — bundle montado no servidor, sem erro de compilação.

**Três evidências independentes de que subiu de verdade** (o projeto já teve deploy fantasma; o
`"Deployed Functions."` do CLI **não** é prova):

| # | O que prova | Evidência |
|---|---|---|
| 1 | **Bundle novo no ar** | Management API: `version` **49 → 50**; `ezbr_sha256` `8b12fe72…04a4f` → `4c82f610…7b125`; `updated_at` 06/09 10:40 UTC; `status` ACTIVE |
| 2 | **Boota e executa** | `POST` com `x-cron-secret` inválido → **HTTP 401** `{"error":"Não autorizado"}` — corpo exato do handler. Descarta BOOT_ERROR e confirma que `CRON_SECRET` existe (ausente daria 500 "mal configurada") |
| 3 | **É o build certo** | `function_logs`: `booted (time: 29ms)` + `[cron] build=S1.1-GATE-EVIDENCIA-DIRETA + ORFAS (2026-09-03)`. Anterior: `REQ-AUDITORIA-CHECA-ERRO-v2-JOB4 (2026-08-28)` |

Só a evidência 3 separa "subiu *algum* bundle" de "subiu o commit que eu queria" — as outras duas,
sozinhas, não distinguem.

**A sonda da evidência 2 é inócua por construção:** o gate do segredo está *antes* de qualquer
chamada ao Alvo e antes do insert em `sync_runs`. Conferido: nenhuma linha nova em `sync_runs` (a
última seguiu sendo 04/09 17:00 BRT).

⚠️ **`function_edge_logs` não carrega os `console.log` da aplicação** — o BUILD_TAG só aparece em
`source = 'function_logs'`, filtrando por
`log_attributes['function_id'] = '62f80576-57c5-4d49-8992-777778e875a8'`.

#### SQL do CHECK: já estava aplicado

O commit manda rodar `docs/SQL-S1.1-CHECK-AUDITORIA-REQ.sql` **antes** do deploy, sob pena de
`total_erros` subir ~2/dia para sempre. Verificado em vez de assumido: o CHECK de
`compras_requisicoes_auditoria` **já contém** `descoberta_alvo` e `sync_status`, e há **1 linha
`descoberta_alvo` gravada em 03/09 16h00** — prova de que o insert já funciona. O DDL entrou em
03/09 entre o commit (10h21) e as 16h00. **Nada foi escrito no banco nesta sessão.**

#### O que observar em `sync_runs` na segunda 08/09

Baseline (sexta 04/09, 8 execuções): `candidatos` 494–498 · `consultados` = `candidatos` ·
`mudaram` **1–6** · `erros` **0** · 48–114 s · `obs = "Job2 elegíveis(sem limit)=418–421, limit=100"`.

**Na 1ª execução (08h00):**

- 🔔 **Ruído esperado, uma vez só: 3 linhas ANTIGAS ganham `total_erros = 1`.** São as órfãs de
  **19/06 15:00, 24/07 08:00 e 02/09 17:00** (confirmadas em 06/09 com `finished_at` e `observacao`
  nulos). O carimbo vai nas linhas passadas, **não** na execução de segunda. Alarme por
  `total_erros > 0` **vai disparar** — é o comportamento desejado (essas falhas eram invisíveis), e
  **não se repete**: `observacao is null` torna a varredura idempotente.
- **`total_mudaram` deve saltar** muito acima de 1–6: os 122 pedidos antes barrados passam a
  disparar, a 100 por ciclo.

**Ao longo do dia:**

- ✅ **Sinal de sucesso: `Job2 elegíveis(sem limit)` CAI** de ~420. É esse número que diz se o gate
  funcionou. Drenagem prevista em ~meio dia útil.
- 🔴 **Sinal de fracasso: elegíveis NÃO cai e `mudaram` fica alto ciclo após ciclo, todo dia.** Seria
  o laço infinito dos 7 pedidos sem rateio em lugar nenhum — exatamente o que a conjunção do gate
  existe para evitar (R3). Se até terça não estabilizar abaixo do baseline, o gate está mandando
  reprocessar o que nunca poderá ser satisfeito.
- **`total_erros` da execução nova deve seguir 0.** Com o CHECK já corrigido, erro aqui é sintoma de
  outra coisa — ler `detalhes`.
- **Duração:** as RPCs de reprocesso somam sobre os 48–114 s atuais. Execução que morra no meio agora
  **se auto-reporta** no ciclo seguinte, em vez de sumir (é a instrumentação da §10.1-b).
- **Log:** `[cron] build=S1.1-GATE-EVIDENCIA-DIRETA…` na execução das 08h confirma que o pg_cron
  pegou o build novo. `gate degradado para o proxy dos jsonb neste ciclo` = a leitura do Hub falhou e
  o critério novo não atuou naquele ciclo (fallback conservador da regra 10); preocupante só se for
  recorrente.

```sql
select started_at at time zone 'America/Sao_Paulo' as inicio_brt,
       total_candidatos, total_mudaram, total_erros,
       round(duracao_ms/1000.0,1) as seg, observacao
from public.sync_runs
where job_type = 'bicephalous' and started_at > '2026-09-08'
order by started_at;
```

**Rollback:** `git checkout 11cbe2b -- supabase/functions/sync-compras-status-cron/index.ts` +
redeploy (volta ao `BUILD_TAG` de 28/08). Sem revert no repo.

---

## 10. S2 — por que o desenho mudou (resultado da §5.1)

A pré-condição T1-a mandava provar que o rateio do jsonb bate com o payload do Load. **Provou-se
metade.**

**Fonte independente encontrada:** `compras_pedidos_auditoria` guarda **4.251 payloads crus** do Load
(`evento='sync_status'`, com `ItemPedCompChildList`). É escrita direto de `resp.data`, sem passar por
`montarItensJsonb` — logo, comparação real entre derivado e cru, não do jsonb consigo mesmo.

**Amostra de 5 pedidos (§5.1):** 4 idênticos linha a linha (classe, CC, percentual de classe,
percentual de CC, valor — zero diferenças). **1 divergiu: `0004452`.**

| item | jsonb | payload cru | CC | valor |
|---:|---|---|---|---:|
| 1, 2, 3 | classe **13.07** | classe **13.03** | igual | igual |
| 4, 5 | iguais | iguais | igual | igual |

Mesmo CC, mesmo valor, **classe reclassificada no ERP**. `detalhes_carregados_em = 22/07`,
`updated_at = 31/08`. **O jsonb não está errado — está velho.**

**Extensão medida em toda a população** (503 pedidos do universo do backfill que têm as duas fontes):

| | pedidos | % |
|---|---:|---:|
| Idênticos | **455** | **90,5%** |
| Conjunto (seq, classe, CC) diferente | 28 | 5,6% |
| Mesmo conjunto, valor diferente | 20 | 4,0% |
| **Divergentes no total** | **48** | **9,5%** |

### O que isso muda

1. **O mapeamento é fiel** — onde as duas fontes são contemporâneas, batem exatamente. A premissa
   "reconstruir por SQL" continua válida.
2. **A frescura não é garantida.** Backfillar só pelo jsonb escreveria rateio desatualizado em
   ~9,5% dos casos (~63 dos 666 sem outra fonte).
3. **Existe fonte melhor para 508 deles:** o `resposta_alvo` mais recente. Proposta: **cascata —
   `resposta_alvo` quando existir, jsonb como fallback**, carimbando a origem de cada linha para
   auditoria posterior.
4. **Sobram 666 sem fonte fresca no Hub.** Ou aceita-se o jsonb com o risco medido, ou eles precisam
   de Load — e aí volta a discussão de janela e lotes que o SQL puro tinha eliminado.

**Isto é decisão do Pedro (§6, bloqueio 1). O backfill não roda até ela.**

---

## 11. Diário

### 06/09/2026 — Deploy da S1.1 (domingo, fora da janela do cron)

Escopo: **só o deploy**. Nenhuma alteração de código, nenhuma escrita no banco, sem push do que já
estava publicado. Registro completo em §10.4.

- **`7b4214b` publicado** às 07h40 BRT — v49 → **v50**, `BUILD_TAG` confirmado por log
  (`booted` + `[cron] build=S1.1-GATE-EVIDENCIA-DIRETA + ORFAS`). Bloqueio 3 e risco R5 fechados.
- **Bloqueio 2 caiu sozinho:** o SQL do CHECK **já estava aplicado** desde 03/09 (verificado, não
  assumido — o próprio doc dizia "NÃO EXECUTADO"). Sem ele o deploy custaria ~2 erros/dia para
  sempre; o custo não existe.
- **Lição de método — `"Deployed Functions."` não é prova.** Fixadas três evidências independentes
  (§10.4): `version`+`sha256` pela Management API, probe 401 sem efeito colateral, e BUILD_TAG em
  `function_logs`. Só a terceira distingue "subiu algum bundle" de "subiu o commit certo".
- **Armadilha de log registrada:** `function_edge_logs` **não** carrega os `console.log` da
  aplicação — é `function_logs`. Buscar no source errado devolve vazio e parece "não bootou".
- **Correção ao CLAUDE.md, para quem vier depois:** o cron deste módulo é o **jobid 1**,
  `0 11-20 * * 1-5` — **de hora em hora, 08h–17h BRT**. As janelas 07h30/12h30/16h30 citadas no
  CLAUDE.md são do **intercompany** (jobid 14), não deste. Já estava certo na §8 daqui.
- **Pendente:** o 1º ciclo real é **segunda 08/09 08h00 BRT**. O deploy não foi validado por
  execução — caminho feliz que ainda não rodou.

### 03/09/2026 — Sessão S1.1 (gate + pré-condição do backfill)

Escopo: §4 do `AJUSTE-S1.1-GATE-E-BACKFILL.md` e a pré-condição §5.1. Backfill **não** executado.
Nenhuma escrita no banco (MCP read-only). Nenhum deploy. Sem push.

- **Gate corrigido** por evidência direta; **instrumentação de execução órfã** adicionada (§9).
- **Relatado antes de tocar em código**, conforme pedido: os 2 commits pendentes de deploy e o
  efeito na fila.
- **§5.1 reprovou parcialmente** — o jsonb é fiel mas 9,5% está desatualizado (§10). O desenho do
  S2 precisa de nova decisão.
- Achado colateral: a órfã do Discovery eram **3**, não 2 (havia uma de 19/06).
- Achado colateral: `docs/SQL-S1.1-CHECK-AUDITORIA-REQ.sql` — sem esse DDL, o deploy obrigatório da
  §4 passa a acusar ~2 erros/dia para sempre, violando o próprio gate de saída da §4.

### 03/09/2026 — Sessão S0 (revisão 2)
100% leitura, conforme o prompt. Nenhuma alteração de código, nenhum SQL de escrita, nenhum deploy,
nenhum push.

- Executados S0-1 a S0-5, matriz §4.2, prova de 3 pedidos §4.3 e a frente nova §4.4 (S0-6 a S0-9).
- **Achado que reordena a missão:** a FASE S1 já estava em produção. Registrado na §A do Discovery.
- Três achados não pedidos: **S0-10** (laço de retentativa, 4 pedidos, resolvido em 24/08),
  **S0-11** (2 execuções sem `finished_at`), **S0-12** (função publicada atrás do `main`).
- Quatro afirmações do prompt corrigidas por medição: cobertura, janela do cron, natureza do
  episódio de 26/08 e a âncora de agosto.
- **O `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` foi sobrescrito** (a v1 de 14/08 está em `0dce7cb`), porque
  o prompt pede esse nome de arquivo.

### 14/08/2026 — Sessão S0 (revisão 1)
Discovery original, commit `0dce7cb`. Concluiu que a chave única do S0-1 **não deve existir** e
recomendou delete-then-insert — recomendação que a implementação de 20/08 seguiu.

---

*Próximo passo: responder às 4 perguntas bloqueantes da §6. Só então desenhar o S1-r e o S2.*
