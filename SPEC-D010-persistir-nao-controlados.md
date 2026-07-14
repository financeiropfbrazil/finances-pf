# SPEC-D010 — Persistir despesa de classe não-controlada (visível, fora do total)

> Via (b) eleita do card D-008 (Pedro, 14/07/2026). Fecha o **buraco estrutural de controle**: hoje o motor DocFin descarta o doc inteiro quando a classe não está em `incluir_controle`, então o Hub joga fora despesa real **sem deixar rastro, em qualquer espécie** — e ninguém sabe quanto nem de quais classes.
> **Dois repos:** o §1 é especificação funcional para o `erp-proxy` (Pedro implementa; o agente não toca). §2–§6 são banco + `finances-pf` (agente implementa, com aprovação).

---

## 0. Requisito inegociável

**Persistir ≠ contar.** Um rateio de classe não-controlada é gravado para ficar **visível e auditável**, mas **NÃO entra em nenhum `sum(valor_brl)`** de tela, RPC ou agregação **por padrão**. Se um único desses caminhos o somar, a despesa infla da noite para o dia. A garantia não pode depender do proxy acertar uma flag — tem de derivar da **fonte única da verdade**.

## 1. Fonte única da verdade: `desp_classe_config.incluir_controle`

Já existe: `boolean NOT NULL DEFAULT false`. É a decisão do Pedro na tela; classe nova nasce **fora** do controle (default seguro intrínseco). Regra de ouro deste desenho:

> **O total = soma dos rateios cuja classe tem `incluir_controle = true`. Nada mais.**

Isso vale para os rateios que já existem (todos de classes em controle hoje) e para os novos. Quando o Pedro marca uma classe, o valor dela **passa a contar automaticamente** — sem re-sync do Alvo, sem migração de dados.

---

## 2. O que muda em `docfin-despesas.ts` (erp-proxy — Pedro implementa)

- **Hoje:** ao explodir o rateio, se a classe não está em controle, **descarta o doc** (não grava nada).
- **Novo:** **sempre persistir** doc + rateio, independentemente de `incluir_controle`. O anti-join do D-001 (chave+valor+colisão) segue decidindo *duplicação*; o `incluir_controle` **deixa de ser gate de gravação** — vira só um atributo.
- Ao gravar cada rateio, setar a coluna nova **`em_controle`** (§3) = valor atual de `incluir_controle` da classe (snapshot para visibilidade). **Não** filtrar por ela.
- Idempotência: o `uq_desp_docfin_rateio_grao` (D-006) já protege; upsert por grão `ON CONFLICT DO UPDATE` (passo 3 do D-006 — bom fazer junto).
- Efeito esperado: `desp_docfin_*` cresce (passa a conter os não-controlados). É o objetivo — visibilidade.

## 3. Schema (banco — agente aplica com aprovação)

Coluna nova, materializada como **snapshot de visibilidade** (o cálculo de segurança não depende só dela — §4):

```sql
alter table desp_docfin_rateio   add column em_controle boolean not null default false;
alter table desp_realizado_rateio add column em_controle boolean not null default false;  -- simétrico (MovEstq tem o mesmo buraco)
```

- **`DEFAULT false` (decisão Pedro 14/07 — corrige a proposta inicial de `true`).** O default governa **linhas futuras**, e a linha futura perigosa é justamente o rateio não-controlado que o proxy vai passar a gravar. Se o proxy esquecer de setar (bug/refactor/merge), `default false` faz o valor **sumir do total** (erro perceptível, lado seguro) em vez de **inflar em silêncio** (armadilha 20). O esquecimento erra para o lado que o Pedro percebe.
- **Backfill (seta `true` EXPLICITAMENTE nas linhas existentes que hoje contam):**

```sql
update desp_docfin_rateio r set em_controle = true
  where exists (select 1 from desp_classe_config cc
                where cc.codigo = r.codigo_classe and cc.incluir_controle);
-- idem desp_realizado_rateio
```
Critério = a classe está em `incluir_controle`. Hoje **todos** os rateios são de classes em controle (o motor descartava os demais) → o backfill deve deixar 100% das linhas em `true` e o total **inalterado**. **Se o dry-run mostrar alguma linha que ficaria `false` (classe hoje fora de controle) ou qualquer mudança de soma por competência, a migração NÃO é neutra — parar e investigar** (indica rateio de classe removida do controle após captura, ou nunca controlada).

- **Sincronização automática (impede flag stale):** trigger `desp_sync_em_controle` em `desp_classe_config`, `AFTER UPDATE OF incluir_controle`, atualiza `em_controle` nos rateios da classe, **pulando competências FECHADAS** (consistente com `desp_recarimbar`):

```sql
-- AFTER UPDATE OF incluir_controle ON desp_classe_config FOR EACH ROW, quando NEW.incluir_controle <> OLD.incluir_controle:
update desp_docfin_rateio r set em_controle = NEW.incluir_controle
  where r.codigo_classe = NEW.codigo
    and not exists (select 1 from desp_competencia_status s
                    where s.ano = r.ano and s.mes = r.mes and s.status = 'FECHADA');
-- idem desp_realizado_rateio
```
Assim `em_controle` = `incluir_controle` da classe (fora meses fechados), sem o Pedro precisar recarimbar.

### 3.1 Trigger de mês fechado NÃO barra o backfill nem a sincronização — confirmado

A trava é `trg_bloqueia_fechado_docfin` = **`BEFORE UPDATE OF conta_hierarquica ON desp_docfin_rateio`**. Ela só dispara quando o `UPDATE` toca a coluna `conta_hierarquica`. O backfill e o trigger de sincronização fazem `UPDATE ... SET em_controle = ...` — **não tocam `conta_hierarquica`** → a trava **não dispara**, o `UPDATE` de `em_controle` passa mesmo em mês fechado. Isso é benigno: `em_controle` é metadado neutro (não muda valor nem conta) e o backfill não altera nenhum total. Ainda assim, o **trigger de sincronização pula meses FECHADOS por princípio** (uma reclassificação futura não deve mexer retroativamente em mês fechado). *(Verificar simetricamente a trava de `desp_realizado_rateio` antes de aplicar — parte do dry-run.)*

## 4. Rede de segurança (defesa em profundidade)

A agregação filtra por `em_controle` (rápido, materializado). Para blindar contra um `em_controle` que por bug fique `true` numa classe fora de controle, a view **também** valida contra a fonte da verdade — o total nunca inclui classe com `incluir_controle=false`, mesmo se a flag divergir. (Custo: um LEFT JOIN em `desp_classe_config`, 267 linhas — irrelevante.)

## 5. O que muda em CADA RPC/view/tela (mapeamento completo — nada mais soma `desp_docfin_rateio`)

Levantamento verificado no banco e no `src/`: a única cadeia que soma é **view → RPC de lista → tela**; `get_despesa_realizada_rateios` só detalha; `desp_recarimbar` só escreve `conta_hierarquica`. Nenhum outro consumidor.

| Objeto | Hoje | Muda para |
|---|---|---|
| **view `v_despesa_realizada_unificada_base`** | `sum(r.valor_brl) AS valor_despesa` (soma tudo) | `valor_despesa = sum(valor_brl) FILTER (WHERE em_controle AND cc.incluir_controle)`; **nova coluna** `valor_fora_controle = sum(valor_brl) FILTER (WHERE NOT (em_controle AND coalesce(cc.incluir_controle,false)))`; LEFT JOIN `desp_classe_config cc ON cc.codigo=r.codigo_classe`. **`CREATE OR REPLACE` — salvar o DDL anterior para rollback** (view alimenta lista *e* export ao mesmo tempo — validação dupla). |
| **RPC `listar_despesa_realizada_unificada`** | `resumo.soma_brl = sum(valor_despesa)` | herda a view → `soma_brl` já vira só o controlado; **adicionar** `resumo.soma_fora_controle` e, por item, `valor_fora_controle`. Opcional: param `p_so_nao_controladas` para a aba de classificação. |
| **RPC `get_despesa_realizada_rateios`** | lista rateios com `classificacao` | **adicionar `em_controle`** no retorno, para a tela marcar os grãos fora do total. |
| **RPC `desp_recarimbar`** | UPDATE `conta_hierarquica` | **sem mudança** (o total não depende dela). A sincronização de `em_controle` é o trigger do §3. |
| **tela `RealizadoDespesas.tsx`** | mostra `resumo.soma_brl` como Total; `valor_despesa` por doc | Total já vira só o controlado (herda). **Adicionar** um bloco no resumo: "Fora do controle: R$ X em N classes não classificadas → classificar" (link p/ config-contas); badge na linha e no accordion para rateio com `em_controle=false` ("fora do total"). |
| **tela `ConfigContasDespesas.tsx`** | abas De-Para + Fechamento | **nova aba "A Classificar"** (§6). |
| **trigger novo** `desp_sync_em_controle` em `desp_classe_config` | — | NOVO (§3). |
| **RPC nova** `desp_listar_classes_nao_controladas` | — | NOVA (§6). |

## 6. Como o Pedro classifica (item 4 — em `/despesas/config-contas`)

Nova aba **"A Classificar"** na tela que já é o lugar disso. Lista as classes com `incluir_controle=false` que **têm rateio persistido** (i.e., apareceram no vazamento), via RPC nova:

```
desp_listar_classes_nao_controladas(p_ano, p_meses[])  -- SECURITY DEFINER, gate admin
  → codigo, nome, grupo, docs, valor_total, exemplos de espécie/entidade
    ordenado por valor_total DESC
```

Cada linha tem ação **"Incluir no controle"** → set `incluir_controle=true` (RPC `desp_set_incluir_controle`, ou estender `desp_set_conta_classe`) → o trigger do §3 atualiza `em_controle` → o valor **migra do "fora do controle" para o total** na próxima leitura, sem re-sync. Se a classe ainda não tem conta padrão (de-para), a própria aba encaminha para o desempate (fluxo já existente).

**Isso é também a resposta ao card D-008:** a "lista de classes dos 371 para classificar" deixa de precisar de um censo one-shot — ela nasce da própria persistência e vive na tela, para sempre e para todas as espécies.

---

## 7. Ordem de implementação (uma etapa por vez, com aprovação)

1. **Schema** (§3): 2 colunas + backfill + trigger. DDL revisado, dry-run do backfill (esperado: 0 mudanças hoje).
2. **View + RPCs** (§5): `CREATE OR REPLACE` view (guardar DDL anterior), ajustar as 2 RPCs, criar `desp_listar_classes_nao_controladas`. **Validação dupla obrigatória** (lista na tela × export Excel reconciliando) — a view alimenta os dois.
3. **Front** (§5–§6): indicador "fora do controle" em `RealizadoDespesas.tsx`; aba "A Classificar" em `ConfigContasDespesas.tsx`. Local + `git push` aprovado.
4. **Proxy** (§2): Pedro implementa o "persistir sempre" + `em_controle` snapshot + upsert. Só depois disso os não-controlados começam a aparecer.
5. **Validação:** re-sync de 1 competência de teste → conferir que `soma_brl` **não muda** (os não-controlados entram como `valor_fora_controle`, fora do total) e que a aba "A Classificar" lista as novas classes.

**Rollback:** colunas são aditivas (drop reverte); view tem DDL anterior salvo; RPCs via `CREATE OR REPLACE` com versão anterior guardada. O proxy é `git revert` do Pedro.

## 8. Garantia do requisito inegociável (checagem final)

Antes de o proxy ligar o "persistir sempre", a etapa 2 (view+RPCs) já tem de estar no ar e validada com `soma_brl` idêntico ao atual. Assim, quando os não-controlados começarem a entrar, eles já nascem **fora do número** — nunca há uma janela em que inflam. Ordem 2→4 é obrigatória.
