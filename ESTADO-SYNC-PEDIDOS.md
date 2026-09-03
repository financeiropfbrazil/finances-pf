# ESTADO-SYNC-PEDIDOS.md — missão Sync de Pedidos

> Estado **próprio** desta missão. Independente da missão *Aprovação de Requisições*
> (`ESTADO-APROVACAO-REQ.md`) — não escrever lá, não ler de lá.
> Documentos da missão: `MISSAO-SYNC-PEDIDOS.md` (espec-mãe) · `PROMPT-S0-SYNC-PEDIDOS.md`
> (substitui a §4 da espec) · `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` (achados, revisão 2).

**Criado em:** 03/09/2026 · **Última atualização:** 03/09/2026 (fim da sessão S0-rev2)

---

## 1. Situação em uma linha

A correção do sync (**FASE S1**) **já foi ao ar** entre 20 e 24/08 e funciona — mas deixou um
**resíduo de 121 pedidos que o cron visita todo dia e nunca corrige**, e **1.053 pedidos fora do
alcance do cron**. Juntos: **1.174 pedidos, R$ 12,19 M sem rateio normalizado**. O backfill, que se
supunha caro, pode ser feito **em SQL puro** — o payload já está no banco.

---

## 2. Fases

| Fase | Estado | Observação |
|---|---|---|
| **S0 — Discovery** | ✅ **concluída** (rev. 1 em 14/08, rev. 2 em 03/09) | `DISCOVERY-SYNC-RATEIO-PEDIDOS.md` |
| **S1 — Correção do sync** | ✅ **em produção desde 20–24/08** (cards C3, C3.2, C3.3, D4) | **Não foi executada por esta missão** — chegou pela trilha de Suprimentos. Ver §4 |
| **S1-r — Resíduo do D1** | 🔴 **aberto, bloqueado por decisão** | 121 pedidos barrados pelo gate de reprocesso. Pergunta 2 do Discovery |
| **S2 — Backfill** | 🔴 **aberto, bloqueado por decisão** | 1.174 pedidos / R$ 12,19 M. Desenho depende da pergunta 1 do Discovery |

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
| …deles, fora da fila do Job 2 | **1.053** · R$ 10.381.241,70 |
| …deles, de **2026** (recorte S3) | **922** |
| …deles, com o rateio **já no jsonb `itens`** (backfill sem Alvo) | **1.173 de 1.174** |
| …deles, **sem itens normalizados** (precisam de carga de item) | 77 |
| Valor 2026 **sem** rateio normalizado | **R$ 14.763.599,73 (78,5%)** |
| Fila do Job 2 (elegíveis) | ~421, **estável/caindo** (−2,7/dia) |
| Cobertura de rateio, coorte ago/set 2026 | **72%** (era 14,3% em 14/08) |

### Âncora anti-wipe (regra 11) — ⚠️ **precisa ser recongelada**
A da espec (R$ 1.642.742,28 / 92 pedidos) **não é reproduzível**. Medições de hoje:

| recorte | pedidos | valor |
|---|---:|---:|
| agosto/2026 inteiro | 228 | **R$ 2.739.015,00** |
| agosto/2026, descobertos até 14/08 | 87 | R$ 1.583.976,69 |

**Proposta pendente de aprovação:** adotar **R$ 2.739.015,00 / 228 pedidos** como âncora.

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

**Lição de processo:** esta missão e a trilha de Suprimentos trabalharam no mesmo arquivo sem que os
documentos se cruzassem. Antes de retomar qualquer fase daqui, **conferir o `git log` do arquivo
alvo** — a espec pode já ter sido implementada por outra frente.

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

## 6. Bloqueios abertos (nada avança sem estas respostas)

| # | Pergunta | Bloqueia |
|---|---|---|
| 1 | Backfill em **SQL puro** sobre o jsonb persistido, em vez de Loads em lote? | desenho do **S2** |
| 2 | Os **121 barrados pelo gate**: corrigir o gate, ou deixar o backfill cobrir? | **S1-r** |
| 3 | Recongelar a **âncora** de agosto em R$ 2.739.015,00 / 228 pedidos? | validação do **S2** |
| 4 | A **dupla convenção de `percentual`** fica como está, ganha coluna, ou ganha `COMMENT`? | dívida estrutural |

As demais perguntas (5 a 12) estão em `DISCOVERY-SYNC-RATEIO-PEDIDOS.md`, seção final.

---

## 7. Riscos vivos

| # | Risco | Evidência |
|---|---|---|
| R1 | 🔴 `percentual` com **duas semânticas** na mesma coluna, não declaradas no schema. Consulta nova que some percentual erra por um fator = nº de classes | incidente de 27/08: R$ 191 mil de valor fantasma na tela |
| R2 | 🔴 O **escopo do líder de CC** (AJUSTE 7.2, entregue 02/09) lê a tabela de rateio **e** o cabeçalho. Com 78,5% do valor sem rateio, apoia-se na *primeira fatia* | `listar_pedidos_escopo` lê as duas fontes |
| R3 | ⚠️ Falha de RPC no rateio **reabre a flag** e o pedido volta — se a forma nova do Alvo for sempre recusada, vira **laço infinito** | 4 pedidos, 20–24/08, resolvidos pelo C3.3 |
| R4 | ⚠️ Execução do cron pode **morrer no meio** sem contar erro (`finished_at` nulo) — invisível a alarme por `total_erros` | 2 casos: 24/07 08:00, 02/09 17:00 |
| R5 | 🔴 Função publicada **2 commits atrás** do `main` — qualquer deploy leva `f7185bf` e `11cbe2b` junto | `BUILD_TAG` publicado ≠ repo |
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

## 9. Diário

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
