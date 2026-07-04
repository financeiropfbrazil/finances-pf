# Relatório — Flag `vinculo_requisicao` em `compras_pedidos`

**Klaus — Auditoria de Suprimentos (Modo A)** · 2026-06-10 · Supabase `hbtggrbauguukewiknew` (read-only)
**Universo:** `compras_pedidos`, total = **1.209** pedidos.

> Contexto: `vinculo_requisicao` registra se o elo ped→req já foi confirmado pelo Load
> completo do Alvo. `nao_verificado` = nunca confirmado (estado inicial da descoberta).
> O **Job 2** (sync de pedidos) é o mecanismo que drena essa fila ao reprocessar
> pedidos vivos, gravando `com_vinculo`/`sem_vinculo` e carimbando `vinculo_verificado_em`.

---

## Erros
Nenhuma inconsistência de integridade detectada nesta auditoria. A flag é coerente
(três valores válidos, sem nulos). Os achados abaixo são de natureza gerencial/operacional.

---

## Alertas

### A1 — 57,73% dos pedidos ainda em `nao_verificado`, mas a fila *acionável* é mínima
A maioria do backlog `nao_verificado` é **residual histórico terminal** que o Job 2
não reprocessa por design (status Encerrado/Cancelado). A fila que de fato importa
para o sync corrente é de apenas **16 pedidos**.

---

## Item 1 — Distribuição atual da flag (% sobre 1.209)

| vinculo_requisicao | qtd | % |
|---|---:|---:|
| nao_verificado | 698 | 57,73% |
| sem_vinculo | 360 | 29,78% |
| com_vinculo | 151 | 12,49% |
| **Total** | **1.209** | **100%** |

```sql
SELECT COALESCE(vinculo_requisicao,'(null)') AS vinculo,
       COUNT(*) AS qtd,
       ROUND(100.0*COUNT(*)/SUM(COUNT(*)) OVER (),2) AS pct
FROM compras_pedidos
GROUP BY 1
ORDER BY qtd DESC;
```

---

## Item 2 — `nao_verificado`: elegíveis ao Job 2 × residual histórico

Critério de elegibilidade: `status` fora de (`Encerrado`,`Cancelado`,`Cancelado Parcial`)
**e** `data_pedido` nos últimos 180 dias.

| bucket | qtd |
|---|---:|
| **elegivel_job2** | **16** |
| residual_historico | 682 |
| **Total `nao_verificado`** | **698** |

```sql
SELECT
  CASE WHEN status NOT IN ('Encerrado','Cancelado','Cancelado Parcial')
            AND data_pedido >= (now() - interval '180 days')
       THEN 'elegivel_job2' ELSE 'residual_historico' END AS bucket,
  COUNT(*) AS qtd
FROM compras_pedidos
WHERE vinculo_requisicao = 'nao_verificado'
GROUP BY 1 ORDER BY 1;
```

**Decomposição do residual (682):**

| motivo | qtd |
|---|---:|
| status_terminal (Encerrado/Cancelado/Cancelado Parcial) | 652 |
| antigo_>180d (vivo, porém `data_pedido` > 180 dias) | 26 |

```sql
SELECT
  CASE WHEN status IN ('Encerrado','Cancelado','Cancelado Parcial') THEN 'status_terminal'
       WHEN data_pedido < (now() - interval '180 days') THEN 'antigo_>180d'
       WHEN data_pedido IS NULL THEN 'data_pedido_null'
       ELSE 'outro' END AS motivo,
  COUNT(*) AS qtd
FROM compras_pedidos
WHERE vinculo_requisicao = 'nao_verificado'
  AND NOT (status NOT IN ('Encerrado','Cancelado','Cancelado Parcial')
           AND data_pedido >= (now() - interval '180 days'))
GROUP BY 1 ORDER BY qtd DESC;
```

> Leitura: dos 698 `nao_verificado`, **652 (93,4%)** são títulos terminais que o Job 2
> não toca, e **26** são pedidos vivos porém antigos (fora da janela de 180 dias).
> Apenas **16** estão dentro da candidatura corrente.

---

## Item 3 — Verificados na última hora (drenagem por ciclo)

| métrica | valor |
|---|---:|
| verificados_ultima_hora (`vinculo_verificado_em` ≥ now−1h) | **97** |
| resolvidos_ultima_hora (saíram de `nao_verificado`) | 97 |
| último `vinculo_verificado_em` | 2026-06-10 19:34:29 UTC |
| `now()` da consulta | 2026-06-10 19:44:26 UTC |

```sql
SELECT
  COUNT(*) FILTER (WHERE vinculo_verificado_em >= now() - interval '1 hour') AS verificados_ultima_hora,
  COUNT(*) FILTER (WHERE vinculo_verificado_em >= now() - interval '1 hour'
                     AND vinculo_requisicao <> 'nao_verificado')              AS resolvidos_ultima_hora,
  MAX(vinculo_verificado_em) AS ultimo_verificado_em,
  now() AS agora
FROM compras_pedidos;
```

> Os 100% de resolução (97/97) confirmam que o Load grava sempre `com_vinculo`/`sem_vinculo`
> (nunca `nao_verificado`), conforme o serviço de Load sob demanda. A capacidade observada
> de drenagem (~97/ciclo) é compatível com a premissa de ~100 por ciclo.

---

## Item 4 — Ciclos para zerar a fila elegível

Fila elegível = **16** · capacidade = 100/ciclo →

```
ceil(16 / 100) = 1 ciclo
```

A fila acionável (`elegivel_job2`) **zera em 1 ciclo** do Job 2. A drenagem medida no
Item 3 (97/h) já excede em muito o backlog elegível — o cron está, inclusive, consumindo
parte do residual antigo no mesmo ciclo.

```sql
SELECT CEIL(COUNT(*)::numeric / 100) AS ciclos_para_zerar
FROM compras_pedidos
WHERE vinculo_requisicao = 'nao_verificado'
  AND status NOT IN ('Encerrado','Cancelado','Cancelado Parcial')
  AND data_pedido >= (now() - interval '180 days');
```

---

## Insights

1. **A flag `nao_verificado` superestima o "trabalho pendente".** 93% dela é ruído
   histórico terminal. Para painéis gerenciais, exibir o **KPI elegível (16)** e não o
   bruto (698), evitando alarme falso de "57% sem vínculo".
2. **Saneamento do residual antigo (26 vivos > 180d).** São pedidos ainda vivos no ERP
   fora da janela de candidatura — não serão drenados pelo Job 2 automático. Avaliar um
   *backfill* pontual via Load sob demanda se o elo req↔ped desses for relevante.
3. **Marcar terminais como não-candidatos explicitamente.** Considerar um valor/derivação
   que separe `nao_verificado` candidato de `nao_verificado terminal`, para a métrica de
   saúde do sync refletir só o que o cron pode resolver.
```
