# ESTADO-REVISAO-SUPRIMENTOS
### Estado vivo da missão · última atualização: 19/08/2026, fim do dia

> **Leia este arquivo ANTES de qualquer coisa nesta missão.** Ele registra o que foi
> executado, o que foi medido e — principalmente — **onde a documentação está errada**.
> Vários fatos abaixo contradizem o `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` e a
> `MISSAO-SYNC-PEDIDOS.md`; quando houver conflito, **este arquivo e os `AJUSTE-RS-*`
> prevalecem**.
>
> Ordem de leitura para sessão nova: `CLAUDE.md` → **este arquivo** →
> `PLANO-REVISAO-SUPRIMENTOS-v1.1.md` → os `AJUSTE-RS-*` do card em questão.

---

## 1. Cards concluídos (19/08/2026)

| Card | O que foi feito | Validação |
|---|---|---|
| **F0** | `Produto/SavePartial` removido da whitelist do passthrough; routers MCP auditados (estão fechados: JWKS + lookup em `profiles`); `cost_centers` sincronizado à mão | — |
| **A1** | Open-load de pedidos migrado para `GET /ped-comp/:filial/:numero` com JWT Supabase (commit `80bf323`) | Operadora sem credenciais locais abriu pedidos sem erro |
| **B1** | Detalhe da requisição liberado para líder do CC, exceto rascunho alheio (commit `f40029c`) | Guilherme (líder de TI, sem `is_admin`) abriu e **rejeitou** pela tela |
| **B3** | `EXECUTE` revogado de `public`+`anon` nas 5 RPCs; `_req_evento` fechada também para `authenticated` | V1: `anon_pode=false` nas cinco; `auth_pode=false` só em `_req_evento` |
| **B4** | Auditoria append-only pela **Seção 3-ALT** (mantém INSERT, revoga UPDATE/DELETE) | V3/V4 conferidos; V5 mostrou eventos novos gravados pelas duas vias |
| **C1** | Tabela `compras_pedidos_anchor` criada; âncoras `S1-t0` e `S1-t1` capturadas | 1.898 pedidos em cada |
| **C2 + B2** | Fila do cron alinhada à contagem (`not.is.true` cobre false e null); `'rejeitada'` acrescentado a `STATUS_TERMINAIS` | 6+ ciclos com **zero erros**; drenagem 415 → 57 |

**Próximo card: C3.** Depois: E1/E2/E3 (data-fix) e Bloco D.

---

## 2. 🔴 Correções de fato — a documentação está errada nestes pontos

1. **O cron de compras se chama `bicephalous`** no campo `job_type` de `sync_runs`. Não
   existe `job_type = 'compras'`. Job pg_cron: `sync-compras-status-cron-hourly`.
2. **Ele roda DE HORA EM HORA**, das 11h às 20h UTC em dias úteis (8h–17h BRT) — cerca de
   **10 ciclos por dia**. As "janelas do cron 07h30 / 12h30 / 16h30 BRT" que o plano e a
   `MISSAO-SYNC-PEDIDOS` repetem **são de outros jobs** (despesas, docfin, intercompany).
   Para deployar esta Edge, escolher um horário logo após uma hora cheia.
3. **Não existe coluna `excluido_alvo`** em `compras_pedidos`. A spec e o plano falam dela
   como se existisse. As únicas colunas com esse teor são `data_aprovacao_alvo`,
   `data_digitacao_alvo` e `synced_at`. **Antes de escrever qualquer lógica de exclusão,
   descobrir como o cross-check realmente marca isso.**
4. **`compras_pedidos_auditoria` NÃO registra valores** — só status, aprovação, comprado e
   próximo aprovador (`status_anterior/novo` etc.). Não serve para investigar mudança de
   campo monetário.
5. **`sync_runs` não tem coluna `job`** — é `job_type`. E `elegiveis_sem_limit` mora em
   `detalhes->>'elegiveis_sem_limit'`.
6. **`compras_pedidos_itens` usa `valor_total_item`**, não `valor_total`.
7. **A auditoria de REQUISIÇÕES é escrita majoritariamente pelo frontend** (887 de 933
   linhas), não pelas RPCs — ver `AJUSTE-RS-B4.md`. Foi por isso que a especificação
   original do B4 foi substituída pela 3-ALT.

---

## 3. Âncora — como usar

**A âncora vigente é `S1-t1`** (capturada 19/08 20:11 UTC, 1.898 pedidos).
A `S1-t0` está **queimada**: acusa 116 alterações legítimas do C2 e fica só como registro
histórico. Não usar.

**Verificação (rodar depois de QUALQUER intervenção no sync) — sucesso = zero linhas:**

```sql
select p.numero
from public.compras_pedidos p
join public.compras_pedidos_anchor a on a.pedido_id = p.id and a.rodada = 'S1-t1'
where a.hash_valores <> md5(concat_ws('|', p.valor_total::text,
      p.valor_mercadoria::text, p.valor_servico::text, p.valor_frete::text,
      p.valor_desconto::text, p.valor_ipi::text, p.valor_outras_despesas::text));
```

⚠️ **Linha não-zero NÃO significa corrupção.** Significa "algum dos 7 campos mudou" — e
`NULL` virando valor legítimo também muda o hash. Foi o que aconteceu no C2: 116 pedidos
acusados, **todos** benignos (o Load preencheu campos que nunca tinham sido carregados).
O teste que separa benigno de corrupção — **tem de dar zero**:

```sql
select count(*) as inconsistentes
from public.compras_pedidos p
join public.compras_pedidos_anchor a on a.pedido_id = p.id and a.rodada = 'S1-t1'
where a.hash_valores <> md5(concat_ws('|', p.valor_total::text,
      p.valor_mercadoria::text, p.valor_servico::text, p.valor_frete::text,
      p.valor_desconto::text, p.valor_ipi::text, p.valor_outras_despesas::text))
  and abs(p.valor_total - (coalesce(p.valor_mercadoria,0) + coalesce(p.valor_servico,0)
      + coalesce(p.valor_frete,0) + coalesce(p.valor_ipi,0)
      + coalesce(p.valor_outras_despesas,0) - coalesce(p.valor_desconto,0))) > 0.01;
```

**Melhoria pendente:** guardar os 7 valores em colunas próprias, não só o hash — hoje a
verificação diz *que* mudou, não *o quê*. Fazer antes do C3.

---

## 4. Estado medido do módulo (19/08/2026, fim do dia)

- **1.898 pedidos** no Hub.
- **Fila do cron:** ~507 candidatos por ciclo, `elegiveis_sem_limit` ~771,
  `PED_BATCH_SIZE = 100`, ordenada por `synced_at asc`, chunks de 5 com 200 ms.
- **Terminais sem detalhe:** 415 → **57** após a drenagem manual (7 ciclos por
  "Rodar Agora"). Os 57 **pararam de cair**, com zero erros nos ciclos.
  Hipótese principal: ficam fora da fila por um **corte de ~180 dias** (todos são de
  nov/2025 a jan/2026, com `updated_at` de 31/03/2026, de alguma carga histórica).
  **Confirmar no C3**; se for isso, ficam para o backfill (Bloco E).
- **`compras_pedidos_itens_rateio`:** vazia para todos os pedidos verificados —
  nunca foi populada por nenhum caminho, em nenhuma geração.
- **`compras_pedidos_parcelas`:** idem, mesmo para pedidos cujo jsonb `parcelas` tem 10
  linhas.
- **Requisições:** 0 em `pendente_aprovacao` no momento; 14 CCs mapeados de 80 ativos,
  3 líderes.

---

## 5. Caso-teste canônico do C3

**Pedido 0004640** (11/08/2026, WATERS TECHNOLOGIES, R$ 114.639,99).

*No Hub hoje:* 2 itens normalizados (60.307,32 + 45.286,57 = 105.593,89), **0 rateios**,
**0 parcelas**, `itens`/`parcelas`/`classe_rateio` = `[]`, `classe_rec_desp` nulo,
`cnpj_entidade` nulo, `nome_cond_pag` nulo, `primeiro_vencimento` nulo,
`detalhes_carregados = true`.

*No Alvo (Load conferido):* rateio por item, classe **19.02**, CC **00008.00001.00006**,
100%; valores 69.353,42 (item 1, **inclui IPI de 9.046,10**) + 45.286,57 = 114.639,99.

*Critério de aprovação:* após um ciclo, 2 linhas em `compras_pedidos_itens_rateio` com
essa classe e CC, percentual 100,0000 por item, soma = 114.639,99, `classe_rec_desp`
preenchido, jsonb da transição populados. **`valor_total` não pode mudar.**

**Outros casos úteis:** `0003406` (2 itens, 3 parcelas, 1 anexo, classe 11.05, CC
00001.00005.00006 — Load completo já conferido) · `0003056` (7 itens, geração antiga) ·
`0003625` (12 linhas de rateio, 2 classes, o único com divergência de centavos entre
cabeçalho e item) · `0004453` (R$ 128.929,14 **sem nenhum CC** — o exemplo do tamanho do
problema).

---

## 6. Decisões vigentes (resumo; os arquivos mandam)

`AJUSTE-RS-C3.md` — rateio do **item** é canônico · gravar `Valor` em reais (coluna nova) ·
validar contra total **com impostos** · `compras_pedidos.centro_custo` não é fonte de
relatório por CC · **envio do Hub já está correto**, não mexer.

`AJUSTE-RS-C3.1.md` — "ausente" inclui **`[]`**, não só NULL (crítico: com `is null` o C3
não corrige nada) · `Valor` do item pode vir **0** (validação forte é percentual, com
fallback derivado) · backfill em **duas trilhas** (jsonb → relacional para os antigos;
Load para os novos) · `centro_custo` preenchido com `classe_rec_desp` nulo prova origem
diferente.

`AJUSTE-RS-B4.md` — auditoria: Seção 3-ALT aplicada; dívida B4-B (mover as 9 escritas do
frontend para RPC) pendente.

---

## 7. Pendências registradas (nenhuma bloqueia o C3)

1. **57 terminais que não drenam** — confirmar o corte de 180 dias.
2. **8 pedidos com `status` NULL** — passaram a entrar na fila com o C2; origem
   desconhecida.
3. **Terminal com Load 404 permanente reentra na fila para sempre** — vale um contador de
   tentativas no C3.
4. **Nome do CC na tela** — detalhe da requisição mostra só o código
   (`00007.00001.00003`). Cosmético, card do Bloco F; depende do espelho `cost_centers`
   estar atualizado (F3).
5. **`funcionario_alvo_codigo` do Ryan** — banco tem `0000063`, roster dizia `0000153`.
6. **`IntegradoFinanceiro`** — 0004705 voltou `"Sim"` e 0004706 `"Não"`, pedidos quase
   idênticos; campo não enviado pelo Hub. Entender o critério do Alvo.
7. **`PedCompUserFieldsObject`** — o Alvo devolve preenchido pelo workflow dele; testar se
   preserva campo livre gravado pelo Hub (necessário para a idempotência do card D3).
8. **Job `nfe` parado desde 11/06/2026** — fora do escopo, mas suspeito.
9. **Pedidos de teste 0004705 e 0004706** — cancelar/excluir no Alvo se ainda não foi feito.

---

## 8. Regras que se mostraram valiosas hoje

- **Rodar o cron manualmente** pelo botão "Rodar Agora" da tela de Cron Requisições é
  seguro e acelera validação (7 ciclos em ~10 minutos, zero erros).
- **Antes de concluir corrupção, provar contra o Alvo.** O susto dos 116 pedidos virou
  alarme falso com um Load do 0003406 e um teste de soma dos componentes.
- **O terminal do Windows trunca saída larga.** SQL gerado por agente em tabelas/molduras
  chega cortado — pedir um comando por bloco, sem arte ASCII.
- **A Seção 1 (rollback) de qualquer SQL não deve ser executada** — é só para guardar.
  Rodar por engano dá erro de objeto já existente (inofensivo, mas assusta).

---

*Atualizar este arquivo ao fim de cada card concluído.*
