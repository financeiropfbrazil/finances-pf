# PROMPT 7.0 — Discovery: bug da fila + visão do líder por Centro de Custo
## Missão Aprovação de Requisições · Fase 7 (frente A)

> `CLAUDE_APROVACAO_REQ.md`, Ajustes 1.1/1.2/1.3, `PROMPT-3-FASE3.md`, `FASE6-MAPA-LIDERES-CC.md`
> e Ajustes 6.1/6.2 permanecem INTACTOS. Este arquivo é a especificação da Fase 7 frente A.
> **Escrito para ser lido por uma sessão NOVA, sem contexto prévio.**

---

## 1. Onde a missão está (estado em 12/08/2026)

O gate de aprovação de requisições está **em produção e funcionando**. Resumo do que existe:

- Requisição criada no Hub é roteada pela RPC `submeter_requisicao`, que olha o
  `codigo_centro_ctrl` do **cabeçalho** da requisição:
  - CC **sem** líder mapeado → `SEM_GATE` → envio direto ao ERP (fluxo legado);
  - criador **é** líder daquele CC → `AUTO_APROVADA` → envio direto, com registro;
  - CC **com** líder (criador não é) → `pendente_aprovacao` → fila do líder.
- Fila em `/suprimentos/aprovacoes` (`SuprimentosAprovacoes.tsx`), gateada por
  `compras.requisicoes.aprovar`. Decisões via `aprovar_requisicao` / `rejeitar_requisicao`
  (esta com catálogo `compras_motivos_rejeicao`).
- Mapa líder↔CC em `compras_lideres_cc`, administrado em `/settings/lideres-cc` (só `is_admin`),
  com atribuição em massa. **13 CCs mapeados de 80** ativos-folha.
- `trg_req_protege_aprovacao` impede escrita direta (via API) nos estados e colunas de decisão.
- Auditoria em `compras_requisicoes_auditoria` (a CHECK constraint de `evento` foi ampliada em
  12/08 — antes disso os eventos da missão falhavam em silêncio).

Documentos na raiz do repo, em ordem de leitura: `CLAUDE_APROVACAO_REQ.md` (guia) ·
`AJUSTE-1.1` · `AJUSTE-1.2` · `PROMPT-3-FASE3` · `AJUSTE-1.3` · `FASE6-MAPA-LIDERES-CC` ·
`AJUSTE-6.1` · `AJUSTE-6.2` · `DISCOVERY-*` · **`ESTADO-APROVACAO-REQ.md`** (o único mutável).

---

## 2. Achados de 12/08 que motivam esta fase

### 2.1 🔴 BUG — o líder não vê a pendência do próprio CC

Caso real, ainda aberto: requisição `7247431f-a21c-4eca-bfee-514276e7fd12`, do requisitante Diego,
`status='pendente_aprovacao'`, `codigo_centro_ctrl='00007.00001.00002'`. A líder ativa desse CC é
`ana.sanches@pfbrazil.com`. **A fila dela não mostra a requisição.**

Já verificado (não repetir, mas confirmar se quiser):
- os dados estão corretos no banco (status + CC + mapeamento ativo);
- RLS de `compras_requisicoes` é `ALL … using(true)` para `authenticated` → **não é RLS**;
- logo, o filtro está **na query do frontend** — hipótese principal: escopo `view_own` aplicado
  antes (ou no lugar) do teste de liderança, descartando requisições de outros usuários.

### 2.2 Decisão do Pedro — visão ampliada do líder

O líder deve enxergar, **além da fila de decisão**, todas as **requisições** e todos os **pedidos**
dos centros de custo pelos quais responde — em qualquer status.

Regra de vínculo, confirmada por medição:

| Documento | Onde vive o CC | Regra |
|---|---|---|
| **Requisição** | `compras_requisicoes.codigo_centro_ctrl` (cabeçalho) e também `compras_requisicoes_itens.codigo_centro_ctrl` | Vínculo pelo **cabeçalho**. Medido: **zero** requisições com itens em CCs diferentes; item e cabeçalho não divergem hoje |
| **Pedido** | `compras_pedidos_itens.codigo_centro_ctrl` (+ `centro_ctrl_label`), no rateio Classe+CC do item | Vínculo por **qualquer CC presente no rateio**, **independente do percentual**. Um pedido rateado entre 3 CCs aparece para os líderes dos 3 |

**Documento é visto inteiro**, nunca recortado por percentual: se um pedido rateia 70% para o CC do
líder e 30% para outro, ele vê o pedido completo, com todos os itens e valores.

### 2.3 Fora desta fase (decidido, não esquecido)

**Aprovação múltipla** (exigir o aval de todos os líderes dos CCs envolvidos) foi **decidida pelo
Pedro**, mas **rebaixada de prioridade**: a medição mostrou **zero** requisições com itens em CCs
distintos. A estrutura existe, o caso ainda não ocorre. Será a frente B, com Discovery próprio.
**Não implementar nada disso agora.**

---

## 3. Regras de engajamento (valem para toda sessão desta missão)

1. **`git pull` antes de tudo.** O Lovable também escreve na `main`.
2. **MCP Supabase é read-only.** O agente **lê** o banco; **toda escrita (DDL/DML) é do Pedro**,
   no SQL Editor. Se precisar de SQL, **escrever num arquivo** para ele colar — nunca executar.
3. ⚠️ **Tags nomeadas obrigatórias** (`$fn$`, `$r1$`…) em todo `CREATE FUNCTION`: o SQL Editor do
   Supabase injeta `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ao detectar `create table` e confunde
   variáveis `declare` dentro de corpo `$$` com nomes de tabela, **corrompendo a função em silêncio**.
4. ⚠️ **`text` não significa domínio livre.** Já mordeu duas vezes (`compras_requisicoes.status` e
   `compras_requisicoes_auditoria.evento`): sempre conferir **CHECK constraint** antes de introduzir
   valor novo em coluna de status/tipo.
5. **`CREATE OR REPLACE` não preserva `SECURITY DEFINER` nem `search_path`** — redeclarar sempre.
   E **recriar funções a partir do `pg_get_functiondef` do banco**, não da especificação: o que está
   em produção já divergiu de documento mais de uma vez.
6. **Staging explícito**: proibido `git add -A` / `git add .`. `types.ts` está em skip-worktree —
   não tocar. Arquivos de outras missões no working tree — ignorar.
7. **Sem push** sem autorização. **Publicar** é só do Pedro.
8. **Frontend nunca usa `.update()`** (CORS bloqueia PATCH) — `.upsert(onConflict)` ou RPC via POST.
9. **Fallback nunca silencioso**: todo retorno inesperado vira mensagem visível.
10. ⚠️ **Zona sensível:** o módulo `compras` tem distinção `view_own`/`view_all` muito marcada.
    Mexer em query de listagem pode **vazar dados entre usuários**. Medir antes de alterar.

---

## 4. Tarefa desta sessão — Discovery, 100% leitura

Nenhuma alteração de código, nenhum SQL de escrita. Saída: **`DISCOVERY-FASE7A.md`** na raiz.

### 4.1 O bug (prioridade)

- **A1.** Qual query alimenta a fila em `SuprimentosAprovacoes.tsx`? Arquivo:linha, filtros aplicados,
  e **em que ordem**. Identificar exatamente o que descarta a requisição do Diego.
- **A2.** O hook de contagem do badge usa o mesmo filtro? (Se o badge mostra 1 e a lista vem vazia,
  ou vice-versa, os dois divergem.)
- **A3.** Como o app resolve `view_own` / `view_all` hoje: onde é lido, como é aplicado em
  requisições e em pedidos. Arquivo:linha de cada ponto.
- **A4.** Proposta da **menor correção possível** para a fila mostrar as pendências dos CCs que o
  usuário lidera, sem afrouxar nada para quem não é líder. **Descrever, não implementar.**

### 4.2 A visão ampliada

- **B1.** Query(s) que alimentam a listagem de **requisições** (`SuprimentosRequisicoes.tsx`) e a de
  **pedidos**: filtros, escopo, paginação, e onde caberia um escopo novo "meus CCs".
- **B2.** Estrutura real do rateio de pedidos: nome da tabela de itens, relação com
  `compras_pedidos`, e se `codigo_centro_ctrl` é sempre preenchido
  (`select count(*), count(codigo_centro_ctrl) from …`).
- **B3.** Quantos pedidos têm rateio em **mais de um CC**? (dimensiona o caso multi-líder)
- **B4.** O escopo novo deve ser resolvido no **cliente** (query com `in` na lista de CCs do líder)
  ou por **RPC/RLS**? Avaliar as duas e recomendar, considerando: max-rows=1000 do PostgREST,
  a regra 10 (vazamento), e o fato de a RLS estar `using(true)` hoje.
- **B5.** Um líder que **não** tem `view_all` — hoje o que ele vê nas duas listagens? (é a linha de
  base contra a qual a mudança será medida)
- **B6.** Há tela de **detalhe de pedido** com gate próprio? Se o líder passa a ver o pedido na
  lista, precisa conseguir abrir.

### 4.3 Entregável extra (relatório de gestão)

- **C1.** Escrever, no mesmo arquivo, uma consulta SQL **pronta para o Pedro colar** que devolva,
  para um período informado: **gasto por centro de custo**, com o(s) líder(es) responsável(is) e a
  marca de quais CCs **não** têm líder. Usar `compras_pedidos_itens.codigo_centro_ctrl` +
  `centro_ctrl_label`, `compras_pedidos.data_pedido`, `valor_total`, e `compras_lideres_cc`.
  ⚠️ Atenção ao **rateio**: o valor do pedido não deve ser contado inteiro para cada CC — verificar
  se há coluna de percentual/valor no item e **explicar no arquivo** o critério adotado (rateio
  proporcional × valor do item × valor do pedido). Se o dado não permitir rateio exato, dizer isso
  claramente em vez de produzir número errado.
  Referência já medida: agosto/2026 (01→12) = **92 pedidos, R$ 1.642.742,28** no bruto
  (1 cancelado, R$ 213,00). O total por CC deve reconciliar com isso.

---

## 5. Gate de saída

1. `DISCOVERY-FASE7A.md` na raiz com A1–A4, B1–B6 e C1, **cada achado com evidência**
   (query + resultado, ou arquivo:linha).
2. Nenhum arquivo de código alterado. Nenhuma escrita no banco.
3. Git: `git add` **apenas** desse arquivo, commit
   `"docs(suprimentos): discovery fase 7a — visao do lider por CC"`. **SEM push.**
4. Terminar com: resumo executivo, **o que contradiz esta especificação**, e as perguntas que só o
   Pedro pode responder.

---

## 6. PROMPT — colar na sessão nova do Claude Code

```
PROMPT 7.0 — Discovery da Fase 7A (bug da fila + visão do líder por CC)

Leia, nesta ordem: CLAUDE.md (siga o protocolo de início de sessão) → ESTADO-APROVACAO-REQ.md
→ PROMPT-7.0-VISAO-LIDER.md (este é o escopo da sessão; contém todo o contexto necessário).
Se precisar de mais contexto histórico, os demais .md da missão estão na raiz.

Execute SOMENTE a §4 do PROMPT-7.0-VISAO-LIDER.md: Discovery, 100% leitura.
Nenhuma alteração de código, nenhum SQL de escrita, nenhum push.

Prioridade: a §4.1 (o bug — há uma requisição real parada agora, a líder não a vê).
Depois §4.2 e §4.3.

Entregue DISCOVERY-FASE7A.md na raiz, com evidência em cada achado, e o gate de saída da §5.
```

---

*Fim do PROMPT 7.0. Depois deste Discovery: correção do bug (frente A1), especificação da visão
ampliada (frente A2), e só então a frente B (aprovação múltipla).*
