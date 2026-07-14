# SPEC-D001 — Correção do vazamento DocFin (serviço + NF-e importação + DIV)

> **Especificação FUNCIONAL para o `erp-proxy`.** O agente não toca o repo do proxy (armadilha 11). O Pedro implementa e deploya no Render, **fora das janelas do cron** (07h30 / 12h30 / 16h30 BRT) ou com o kill-switch de `sync_settings` (`job_name='sync-docfin-despesas'`, `enabled=false`) acionado durante a subida.
> **Escopo:** rota `POST /docfin-despesas/sync-batch` (e, por consistência, a `/docfin-despesas/censo`). Nada no `finances-pf` muda — a Edge `sync-docfin-cron` é magra e continua igual.
> **Data:** 14/07/2026 · **Origem:** D-001 fundido (cards D-001 + D-004-A1 no PLANO-DESPESAS.md).

---

## 0. Resumo executivo

Hoje a rota `docfin-despesas` descarta um doc se **`origem_alvo = Estoque`** (funil ORIGEM, proxy de anti-duplicação) **ou** se a espécie está fora da allowlist (funil ESPÉCIE). Os dois funis juntos jogam no vão **371 docs / R$ 1.475.637** de despesa real jan–jun que o MovEstq **não** captura.

A causa raiz do descarte indevido é a **armadilha 19**: `origem_alvo` (módulo do lançamento financeiro no DocFin) **não** prova presença no MovEstq. NF-e de importação chega ao DocFin como `origem_alvo="Vendas"` e ao MovEstq como `origem="Estoque"` — campos de fontes diferentes, não comparáveis.

**A correção substitui o proxy `origem_alvo=Estoque` pelo anti-join REAL contra `desp_realizado_doc`** (a rota destino), para o conjunto de espécies-alvo. Admite o doc **se, e só se, ele não está no MovEstq** (chave + valor, all-dates), com guarda de colisão. Isso recupera os 371 sem reintroduzir a dupla contagem dos que já estão capturados.

---

## 1. O que muda em `docfin-despesas` (sync-batch)

Para o **conjunto de espécies-alvo** (definido na §2), a decisão de admissão passa a ser:

```
para cada doc DocFin da competência cuja espécie ∈ ESPECIES_ALVO (case-insensitive):
    chave  = (especie_norm, codigo_entidade, numero_base)      # §3
    valor  = soma das parcelas do doc (valor_documento BRL)
    match  = lookup(chave) no índice do MovEstq (desp_realizado_doc, ALL-DATES)

    se match tem ≥2 docs com valores distintos:   → NÃO admite · log REVISAO_COLISAO   # guarda, §3.3
    senão se existe algum doc no match:           → NÃO admite (já no MovEstq)
             ├─ |valor − valor_movestq| ≤ TOL:      log DESCARTE_JA_CAPTURADO
             └─ |valor − valor_movestq| >  TOL:      log REVISAO_VALOR                  # armadilha 18
    senão (chave ausente do MovEstq):             → ADMITE (Load individual + rateio + grava)
```

Regras de contorno:
- O funil ORIGEM (`origem_alvo=Estoque`) **deixa de descartar** as espécies-alvo — quem decide agora é o anti-join. `origem_alvo` vira apenas informativo (grava-se em `desp_docfin_doc.origem_alvo`, não filtra).
- O funil ESPÉCIE precisa **admitir** as espécies-alvo (§2) — hoje NF-e e as de serviço têm `allowlist=false`.
- **Espécies NÃO-alvo (FAT, PROV, CAR, CART, JUR, CF, ADT, CSRF, …) não mudam nada** — continuam com o descarte atual. A spec não as toca (JUR/CF/ADT/CSRF são o card D-005, decisão pendente do Pedro).
- **Só admite doc `Tipo='PAG'`, filial 1.01** (regra 6 do PLANO) — inalterado.

---

## 2. Espécies que entram (ESPECIES_ALVO)

Comparação **case-insensitive e tolerante a hífen/caixa** (armadilha 15 — o Alvo manda `CT-e`/`Ct-e`, `NF3E`/`NF3-e`):

| Grupo | Espécies (normalizadas) | Vazamento jan–jun |
|---|---|---|
| Serviço | `NFS-e`, `CT-e`, `NFCom`, `NF3E`, `NF3-e` | 148 docs / R$ 727.536 |
| Mercadoria/importação | `NF-e` | 198 docs / R$ 592.155 |
| Diversos | `DIV` | 25 docs / R$ 155.945 |
| **Total** | | **371 docs / R$ 1.475.637** |

Nota: `DIV` **já está** na allowlist hoje (era barrado só pelo funil ORIGEM). `NFCom` também. As demais (NFS-e, CT-e, NF3E, NF3-e, NF-e) precisam ENTRAR na allowlist. Normalizar antes de comparar: `lower(trim(especie))`, e unificar as variantes de hífen (`nf3-e` ≡ `nf3e`, `ct-e` ≡ `ct-e`).

---

## 3. O anti-join (critério de admissão)

### 3.1 Chave
```
especie_norm = lower(trim(especie))                 # 'nf-e', 'nfs-e', 'ct-e', 'div', ...
codigo_entidade                                     # ex.: '0000153'  (com zeros à esquerda, como vem do Alvo)
numero_base  = ltrim(split_part(numero,'/',1), '0') # 'DocFin/parcela' → parte antes da '/', sem zeros à esquerda
chave = (especie_norm, codigo_entidade, numero_base)
```
Do lado do MovEstq (`desp_realizado_doc`) aplica-se a MESMA normalização. Validada: injetora, match 80,6%, 4 colisões em 5.117 chaves (0,08%), todas fora das espécies-alvo.

### 3.2 Valor e tolerância
- Compara `valor` do doc DocFin (soma das parcelas = `valor_documento` BRL) contra `valor_documento` do MovEstq.
- `TOL = max(R$ 1,00 ; 0,5% do maior valor)`. Empiricamente 98,7% dos matches batem ≤ R$ 1,00.
- **Regra dura anti-dupla-contagem:** presença de chave no MovEstq ⇒ **não admite**, independentemente do valor. Se o valor bate (≤ TOL) é descarte confirmado; se diverge (> TOL), vai para `REVISAO_VALOR` — **nunca é admitido no escuro** (armadilha 18). Recuperar um divergente é decisão manual do Pedro, não automática.

### 3.3 Guarda de colisão (obrigatória)
Se a chave do candidato aponta para **≥ 2 docs de valores distintos** no MovEstq → **não admite**, loga `REVISAO_COLISAO`. Colisão é o único vetor pelo qual o anti-join poderia admitir errado e gerar dupla contagem. Hoje há 4 colisões (3 FAT + 1 DIV `10117`×`10117/A`, criada pelo `split_part` colapsar sufixo pós-barra) e **zero candidatos a admissão afetados** — mas a guarda protege competências futuras. Na dúvida, **dropar vence admitir**.

### 3.4 All-dates (armadilha 17)
O índice do MovEstq é montado sobre **`desp_realizado_doc` de TODAS as datas**, não só jan–jun. Um doc de competência 2026 pode ter entrado no MovEstq com competência 2025. Restringir a jan–jun triplica o falso-vazamento. Implementação sugerida: no início de cada `sync-batch`, carregar em memória o índice `chave → [(valor, chave_movestq)]` de todo o `desp_realizado_doc` (~5k linhas, cabe) e consultar em O(1) por doc.

---

## 4. Por que é seguro (não há dupla contagem)

1. **Admissão condicionada à ausência real no MovEstq.** Um doc só é gravado na rota DocFin se o anti-join confirmar que o MovEstq não o tem. Os 11 NF-e-importação que o D-004 teria duplicado (R$ 612.770) casam a chave+valor no MovEstq → **descarte confirmado, não admitidos**.
2. **A anti-duplicação passa a ser medição, não dedução** (armadilhas 19, 20). Substituímos o proxy frágil (`origem_alvo`) pela prova direta (anti-join).
3. **Presença de chave ⇒ não admite**, mesmo com valor divergente. O pior caso (chave bate, valor diverge) vai a revisão, nunca a gravação.
4. **Guarda de colisão** fecha o único vetor residual.
5. **Espécies não-alvo intocadas** — nenhum risco de regressão em FAT/PROV/etc.

---

## 5. Idempotência do re-sync

**Correção de premissa (a instrução original mencionava `uq_desp_rateio_grao`):** esse unique está em **`desp_realizado_rateio`** (rota MovEstq) — **não** protege a rota DocFin. A idempotência do re-sync DocFin vem do **motor "espelho por `chave_docfin`"** do proxy (a Edge documenta isso: "o motor é espelho por chave, reprocessar não duplica"). O PK de `desp_docfin_doc` é `(codigo_empresa_filial, chave_docfin)`.

✅ **Confirmado empiricamente (14/07) — o motor faz delete→insert dos rateios por `chave_docfin`.** Embora `desp_docfin_rateio` tenha PK só em `id` (uuid), sem unique natural, a prova está no banco: as competências mai/2026 e jun/2026 foram reprocessadas pelo cron **33× e 30×** respectivamente e mantêm razão `sum(rateio)/valor_documento ≈ 1.0` com **0 docs inflados**; os `created_at` dos rateios de maio vão até a última rodada (14/07 10:10), enquanto os docs nasceram em 02/06 — ou seja, **os rateios são recriados a cada espelho** (delete→insert), não acumulados. **Para as espécies-alvo do D-001, o backfill de jan–jun é idempotente — reprocessar as 6 competências inteiras não acumula rateio.**

⚠️ **Ressalva (bug ortogonal, não do D-001 — card D-006):** existe um bug de **duplicação intra-rodada** que grava o mesmo grão 2-3× numa única execução, atingindo **exclusivamente as espécies `RDESP` e `PC`** (despesa nativa). Resíduo preso em 8 docs de abril (~R$ 22,3k, dominado pelo PC `26217`). **Nenhuma espécie-alvo do D-001 é afetada** (NF-e/NFS-e/CT-e/NFCom/NF3E/DIV têm 0 duplicados). O backfill do D-001 não piora esse resíduo (o delete→insert o remove ao reprocessar abril; se o bug persistir no Load de RDESP/PC, volta ao mesmo estado, nunca pior). Tratar o D-006 em separado.

---

## 6. Procedimento de re-sync jan–jun + delta esperado

**Baseline pré-sync** salvo em `snapshot-despesas-pre-D004.json` (estado de `desp_docfin_doc`/`rateio` em 14/07). Depois do sync, o delta tem de bater **exatamente** com a tabela abaixo. Excedeu → entrou algo que não devia (provável dupla contagem ou rateio acumulado — §5).

**Delta esperado (só docs que FALHAM o anti-join = os 371):**

| Competência | Δ docs | Δ valor | Serviço | Mercadoria NF-e | DIV |
|---|---|---|---|---|---|
| 2026-01 | +49 | +R$ 171.397,49 | +10 / R$ 76.163 | +38 / R$ 95.036 | +1 / R$ 199 |
| 2026-02 | +67 | +R$ 237.243,44 | +32 / R$ 133.256 | +31 / R$ 77.876 | +4 / R$ 26.111 |
| 2026-03 | +58 | +R$ 195.575,26 | +24 / R$ 78.601 | +33 / R$ 116.776 | +1 / R$ 199 |
| 2026-04 | +66 | +R$ 385.703,43 | +17 / R$ 159.871 | +44 / R$ 195.280 | +5 / R$ 30.552 |
| 2026-05 | +59 | +R$ 171.281,25 | +27 / R$ 85.586 | +25 / R$ 35.004 | +7 / R$ 50.692 |
| 2026-06 | +72 | +R$ 314.435,68 | +38 / R$ 194.060 | +27 / R$ 72.184 | +7 / R$ 48.191 |
| **Total** | **+371** | **+R$ 1.475.637** | 148 / R$ 727.536 | 198 / R$ 592.155 | 25 / R$ 155.945 |

*(Valores estimados pelo `valor_soma_original` do censo. Pequenas diferenças por câmbio/retenção no Load individual são esperadas; a **contagem de docs** por competência é o critério duro — tem de bater exatamente.)*

**Como disparar** (a janela rolante do cron cobre só 3 meses — jan–abr precisam reabertura manual):
1. Kill-switch OU deploy fora da janela do cron.
2. Reabrir as 6 competências como `PENDENTE` em `desp_docfin_competencias` (jan..jun/2026) — **escrita no banco, peço aprovação e executo uma a uma no rito** (não é ação desta spec).
3. Rodar o cron 6× (uma competência por rodada): `SELECT public.call_sync_docfin_cron('manual_admin');` no SQL Editor (regra 8). Conferir `net._http_response` e `sync_runs` (`job_type='docfin_despesas'`) a cada rodada.
4. Sync é silenciosamente falível (`persistence?.updated ?? 0`) — conferir `sync_runs.total_erros` e o `summary` de cada rodada.

---

## 7. Reconciliação e critério de aceitação

Após as 6 competências:
```sql
-- por competência: novo estado vs baseline
select to_char(data_competencia,'YYYY-MM') comp, count(*) docs, round(sum(valor_documento),2) valor
from desp_docfin_doc
where data_competencia >= '2026-01-01' and data_competencia < '2026-07-01'
group by 1 order by 1;
```
- **Aceita** se, para cada competência, `docs_novo − docs_baseline = Δ docs esperado` (tabela §6). A contagem é exata; o valor com tolerância de câmbio.
- **Rejeita e investiga** se qualquer competência exceder o Δ (dupla contagem / rateio acumulado) ou ficar aquém (anti-join barrando demais).
- Conferir também que os **logs** somam certo: `ADMITE = 371`, `DESCARTE_JA_CAPTURADO ≈ 1905`, `REVISAO_VALOR = 17`, `REVISAO_COLISAO = 0` (nas espécies-alvo).
- Amostra dura: confirmar que os 11 NF-e-importação (BALLY 4345, MICROLUMEN 4737/4394/4393, ZEUS 4398/4770/4566/4431, R.S.Hugues 4792, QOSINA 4613, ALEGRIA 12545) **continuam ausentes** de `desp_docfin_doc` (foram DESCARTE_JA_CAPTURADO), e que os 2 genuínos (Shanghai 4562, Taiwan 4803) **entraram**.

---

## 8. Guardas e armadilhas (checklist de implementação)

- [ ] Normalização de espécie **case-insensitive + hífen** nos dois lados (armadilha 15).
- [ ] Anti-join sobre MovEstq **all-dates** (armadilha 17).
- [ ] Presença de chave ⇒ não admite; valor divergente ⇒ revisão, nunca gravação (armadilha 18).
- [ ] **Guarda de colisão** (§3.3).
- [ ] `origem_alvo` deixa de filtrar as espécies-alvo, mas **continua sendo gravado** em `desp_docfin_doc` (informativo).
- [ ] Espécies não-alvo (FAT/PROV/CAR/CART/JUR/CF/ADT/CSRF) **sem alteração**.
- [ ] Rateios substituídos por doc no re-sync (§5) — **verificar antes do backfill**.
- [ ] Câmbio: NF-e de importação pode ter valor em moeda estrangeira no Alvo; garantir que grava `valor_brl` no rateio e usa BRL no anti-join (evitar o Finding F3 do outro módulo: câmbio 0 ⇒ valor 0 silencioso).

---

## 9. Rollback

- Código do proxy: `git revert` no repo do erp-proxy + redeploy (só o Pedro).
- Dados: os docs admitidos ficam em `desp_docfin_doc`/`rateio` das competências jan–jun. Rollback de dados = deletar os docs gravados por esta mudança (identificáveis por `sync_em` da rodada e por serem espécies-alvo com `origem_alvo` que antes eram descartadas) — **escrita, com rito e WHERE revisado**. Como o motor é espelho por chave, reverter o código + re-sync também restaura o estado anterior (os admitidos deixam de sê-lo e o próximo espelho os remove — **confirmar que o motor remove docs que deixaram de ser admitidos**, senão o rollback de dados é manual).
- Mês fechado: se alguma competência jan–jun já estiver FECHADA, a trigger `desp_bloqueia_rateio_fechado` barra a escrita — reabrir é decisão do Pedro, nunca atalho do agente (regra 0.7).

---

## 10. Fora do escopo desta spec

- **D-005** — JUR/CF/ADT/CSRF (7 docs / R$ 33k): Pedro classifica na tela do Alvo antes de qualquer admissão.
- **17 docs de revisão** (R$ 121k, 14 CT-e da transportadora ent 0000132): já no MovEstq, ficam fora; frete compõe custo da mercadoria (nota Fase 2 no PLANO).
- **D-002** — 4 CT-e J.V. Brito (provável causa no Alvo).
