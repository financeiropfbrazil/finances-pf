# PLANO-REVISAO-SUPRIMENTOS — v1.1 (17/08/2026)
## As 4 frentes: Aprovação do Líder · Sync de Pedidos · Gateway/Autenticação · Núcleo de Criação

> **v1.1 substitui a v1.0** (que permanece no repo, intacta, pela regra da casa). Mudanças:
> ordem por dependência (A3 antes de A2), **cards estruturados** com campos fixos, os **três
> alertas de leitura obrigatória** abaixo, protocolo **preview→apply→verify** em todo SQL, e
> a dívida nova das flags de completude. Decisões D1–D9 (§0) inalteradas.
>
> **Base factual:** relatórios CDX-1..4 (Codex, 17/08, leitura pura) + código real do
> erp-proxy + decisões do Pedro. **Não altera a MISSAO-SYNC-PEDIDOS.md.**

---

## ⚠️ TRÊS ALERTAS — ler antes de qualquer conclusão sobre este módulo

1. **A mudança da âncora de agosto NÃO prova corrupção.** 92→102 pedidos e
   R$ 1.642.742,28→R$ 1.754.181,16 é agosto **aberto**, recebendo pedidos legítimos. Total
   de mês corrente não é âncora. A âncora real deste plano é coorte congelada + hash (D1).
2. **"Parcelas (0)" NÃO prova pedido criado sem parcelas.** O 0004677 nasceu no Alvo
   (`criado_no_hub=false`), não passou pelo `enviarPedido`. Os 93 pedidos criados pelo Hub
   têm parcelas normalizadas. É lacuna do **espelho**, não do núcleo.
3. **`detalhes_carregados=true` NÃO significa detalhe completo.** Na prática significa
   "itens persistidos" — parcelas, rateio e anexos podem estar vazios com a flag ligada
   (277 pedidos nessa condição). Nenhuma lógica nova deve tratá-la como completude; a
   quebra em flags específicas é dívida registrada (§Pendências).

**Dependência que reordenou o plano:** o **open-load é um TERCEIRO ESCRITOR** — grava jsonb
de itens, parcelas, rateio e anexos, na mesma superfície que a S1 vai corrigir. Por isso ele
é o primeiro card do plano (A1) e o B2 precisa conhecê-lo.

---

## 0. Decisões registradas (17/08/2026)

| # | Decisão |
|---|---|
| D1 | **Âncora** = coorte congelada por rodada: IDs + hash dos **7 campos monetários** (sem `status`, que muda legitimamente pelo cron), capturada em t0 e conferida depois. |
| D2 | **Sem UNIQUE simples no rateio** — repetição (item, classe, CC) é legítima (25+25+50). Reprocesso via **RPC transacional `service_role`**: valida → apaga filhos dos pedidos processados → reinsere, na mesma transação. |
| D3 | **Parcelas entram na S1** — mesmo Load, custo marginal zero, cobre os 277. |
| D4 | **Detalhe do líder**: vê requisições do CC que lidera, **exceto rascunho alheio**. |
| D5 | **KPIs**: pendentes/rejeitadas fora dos totais de fluxo ERP, em bloco próprio "No gate". |
| D6 | **Ordem de migração pós-open-load**: escrita direta (Notas de Serviço) P0; depois NF Entrada → Contas a Pagar → Sales. |
| D7 | **ApiTester**: mantém, admin-only, via `/alvo/passthrough`. |
| D8 | **Idempotência**: uuid do pedido do Hub em campo livre de `PedCompUserFieldsObject` + reconciliação antes de qualquer retry. |
| D9 | **Higiene**: aposentar as 5 Edges fósseis e rotacionar a senha do ERP ao fim da migração. |

---

## 1. Regras de engajamento (todas as sessões)

1. `git pull --ff-only` antes de tudo. Falhou → parar e reportar.
2. **MCP Supabase read-only.** Toda escrita é do Pedro, no SQL Editor, no formato §2.
3. Tags nomeadas (`$fn$`, `$r1$`…) em todo `CREATE FUNCTION`.
4. `text` não é domínio livre — conferir CHECK antes de valor novo.
5. `CREATE OR REPLACE` não preserva `SECURITY DEFINER`/`search_path`: recriar a partir do
   `pg_get_functiondef` **do banco**, redeclarando os dois.
6. `revoke execute` precisa de `from anon` **e** `from public`.
7. Staging explícito; proibido `git add -A`/`.`; `types.ts` skip-worktree; **Publicar é do
   Pedro**.
8. Edge: deploy CLI `--project-ref hbtggrbauguukewiknew`, fora das janelas
   (07h30/12h30/16h30 BRT), confirmar que responde, conferir `sync_runs` no ciclo seguinte.
9. **erp-proxy OFF-LIMITS para agentes** — vira checklist para o Pedro (GitHub Web).
10. Fallback nunca silencioso. Nada toca `status` nem os 7 campos de valor fora dos
    caminhos legítimos do cron.
11. Uma tarefa por vez; prompts imutáveis (mudança = `AJUSTE-RS-x.md`).
12. **Todo card tem "Teste com usuário real"** — Pedro é admin e tem bypass; teste de admin
    não valida gate nenhum.

---

## 2. Protocolo de SQL — preview → apply → verify

Para reduzir atrito **sem abrir escrita ao agente**, todo SQL deste plano vem em três blocos
colados em sequência no SQL Editor, com resultado visível a cada passo:

- **PREVIEW** — `SELECT` que mostra o que será afetado (ou gera o comando com assinatura
  real). Zero efeito colateral.
- **APPLY** — o comando em si, statement atômico (sem `BEGIN/COMMIT` — o SQL Editor
  abandona blocos em silêncio). `UPDATE`/`DELETE` sempre com `RETURNING`.
- **VERIFY** — `SELECT` que prova o efeito. **Critério de sucesso explícito** em cada card.

Regra do agente: **nunca entregar APPLY sem PREVIEW e VERIFY ao lado**. Regra do Pedro:
não colar o APPLY se o PREVIEW não bater com o esperado do card.

---

## 3. Anatomia de um card

Todo card abaixo tem, na ordem: **Problema e evidência · Risco atual · Mudança proposta ·
Pré-requisitos · Campos intocáveis · Teste com usuário real · Métrica antes/depois ·
Rollback · Janela segura · Responsável (Hub / Supabase / erp-proxy / Pedro)**.

---

## SEQUÊNCIA MESTRE

```
BLOCO A — Hotfix operacional        A1 (open-load)  → A2 (validação Mirlene)
BLOCO B — Segurança da aprovação    B1 (detalhe líder) · B2 (guarda) · B3 (ACLs) · B4 (auditoria)
BLOCO C — Preparação da S1          C1 (âncora) · C2 (seleção do cron) · C3 (S1 + RPC)
BLOCO D — Endurecimento da criação  D1 (invariantes) · D2 (anexos) · D3 (idempotência) · D4 (normalização) · D5 (255)
BLOCO E — Data-fix                  E1 (drenagem) · E2 (backfill dirigido) · E3 (reconciliação)
BLOCO F — Dívidas                   F0..F6 (gateway, credenciais, cost_centers, fósseis, KPIs, moeda)
```

**F0 é imediato** (5 min, GitHub Web) apesar de estar no bloco de dívidas.

---

# BLOCO A — Hotfix operacional

## CARD A1 — Open-load via gateway

**Problema e evidência.** `SuprimentosPedidoDetalhe.tsx:229-245` → `fetchLoadWithRetry` →
`alvoService.authenticateAlvo()` lê `alvo_username`/`alvo_password` do `localStorage` e fala
direto com o Alvo. Operadora sem as chaves: `PedCompLoadError: Falha na autenticação ERP`
(`alvoPedCompLoadService.ts:35-49`). Caso real: Mirlene, 17/08, pedido 0004677.

**Risco atual.** Toda a operação não-admin vê espelho defasado em qualquer card; e o
open-load é **terceiro escritor** (jsonb de itens/parcelas/rateio/anexos) — enquanto falha
para uns e funciona para outros, a completude do espelho depende de **quem abriu a tela**.

**Mudança proposta.** Trocar o transporte para `GET {PROXY}/ped-comp/{filial}/{numero}` com
`Authorization: Bearer <JWT Supabase>`. A rota existe e é superior: máscara 412→404 e guarda
anti-wipe (502 em 200-sem-`Numero`) já vivem nela. Filial vem do pedido, nunca hardcoded.
Remover o import de `authenticateAlvo` **deste service apenas**.

**Pré-requisitos.** Nenhum. (Rota pronta; JWT de qualquer operador passa no
`requireSupabaseAuth`.)

**Campos intocáveis.** Nada de `excluido_alvo` por 404 isolado; 502 → erro sem escrita
(snapshot local preservado); guarda anti-wipe cliente **mantida** como redundância.

**Teste com usuário real.** Mirlene (sem credenciais locais) abre um pedido: sem toast de
erro, status e itens atualizam, DevTools sem chamada a `pef.it4you`.

**Métrica antes/depois.** Antes: 100% de falha do open-load para quem não configurou as
chaves. Depois: 0 ocorrências de "Falha na autenticação ERP" no console da operação.

**Rollback.** Reverter o commit (mudança isolada num service).

**Janela.** Qualquer horário; exige Publicar no Lovable.

**Responsável.** Hub (agente) + Publicar (Pedro).

### PROMPT A1

```
PROMPT A1 — Open-load via erp-proxy (P0)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS-v1.1.md (alertas do topo + CARD A1).

Escopo ÚNICO: src/services/alvoPedCompLoadService.ts (+ o mínimo em
SuprimentosPedidoDetalhe.tsx se a assinatura mudar).
Trocar fetchLoadWithRetry: de authenticateAlvo()+Alvo direto para
GET {ERP_PROXY_URL}/ped-comp/{codigo_empresa_filial}/{numero} com Bearer do JWT da
sessão Supabase. Reusar a constante/env de proxy que os services já migrados usam
(alvoEntidadeService, alvoEstoqueService) — localizar, não inventar.
Preservar: guarda anti-wipe por Numero; isPedidoInexistenteNoAlvo aceitando 404 e 412;
404 isolado nunca marca excluido_alvo; 502 → PedCompLoadError sem escrita.
NÃO tocar: download de anexos (Bloco F), alvoService.ts, demais consumidores.
Entrega: diff + build + push com staging explícito. Sem Publicar.
```

## CARD A2 — Validação com a operação

**Problema e evidência.** Correção de transporte só está provada em uso real; o CDX-3 não
pôde testar em navegador.

**Mudança proposta.** Pedro publica e acompanha Mirlene abrindo 2–3 pedidos, incluindo o
0004677.

**Teste com usuário real.** É o card inteiro.

**Métrica.** Console limpo; `parcelas`/`itens` do 0004677 populados após a abertura (prova o
terceiro escritor funcionando).

**Rollback.** Reverter A1.

**Responsável.** Pedro.

---

# BLOCO B — Segurança da aprovação

## CARD B1 — Detalhe do líder (§6.7)

**Problema e evidência.** `SuprimentosRequisicaoDetalhe.tsx:143-165` retorna `null` antes de
avaliar liderança; `isLiderDoCC` (:242-256) depende de `req` já carregada. Líder decide "às
cegas" pela fila. Nunca apareceu porque nenhum líder sem `is_admin` havia aberto requisição
de terceiro.

**Risco atual.** Aprovação sem leitura do que se aprova — fragilidade de controle interno
justamente no gate que o projeto criou.

**Mudança proposta.** Consultar `compras_lideres_cc` (vínculo ativo, CC exato,
`lider_user_id = auth.uid`) **antes** do `return null`. Liberar `owner || funcionário ||
líder ativo do CC`, com a exceção D4: líder **não** vê rascunho alheio.

**Pré-requisitos.** Confirmar nomes reais das colunas via MCP (regra 4/5).

**Campos intocáveis.** Fila, RPCs, rota no `App.tsx` (já correta).

**Teste com usuário real.** **Líder sem `is_admin`** (Ana Sanches): abre pendência da fila →
detalhe carrega; abre rascunho de terceiro do mesmo CC → bloqueado; abre requisição de CC
que não lidera → bloqueado.

**Métrica.** Antes: 100% de "Requisição não encontrada" para líder não-admin. Depois: 0.

**Rollback.** Reverter o commit.

**Janela.** Qualquer; exige Publicar.

**Responsável.** Hub (agente) + teste (Pedro/Ana).

### PROMPT B1

```
PROMPT B1 — Detalhe do líder (P0, decisão D4)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS-v1.1.md (CARD B1).
Escopo ÚNICO: src/pages/SuprimentosRequisicaoDetalhe.tsx.
Antes do return null do controle de escopo, consultar compras_lideres_cc (colunas reais
conferidas via MCP) por CC da requisição + lider_user_id = user.id + vínculo ativo.
Liberar owner || funcionário || líder ativo do CC, EXCETO quando status='rascunho' e o
usuário é só líder (D4). Não tocar em mais nada.
Entrega: diff + build + push (staging explícito). Sem Publicar.
```

## CARD B2 — `rejeitada` na guarda anti-rebaixamento

**Problema e evidência.** `sync-compras-status-cron/index.ts:492` lista apenas
`convertida_pedido` e `cancelada` como terminais de requisição.

**Risco atual.** Baixo hoje (as 2 rejeitadas não têm `numero_alvo`, não casam com o list),
mas é defesa ausente: uma rejeitada que ganhe número volta a `sincronizada` e vaza para a
compra.

**Mudança proposta.** Adicionar `rejeitada`. (`pendente_aprovacao`/`aprovada` não entram —
sem `numero_alvo`; confirmar por leitura e registrar no commit.)

**Campos intocáveis.** Demais ramos do cron.

**Teste com usuário real.** Não aplicável; validação é por `sync_runs` limpo no ciclo
seguinte.

**Métrica.** Antes: 2 estados terminais. Depois: 3, sem erro no ciclo.

**Rollback.** Redeploy da versão anterior.

**Janela.** Fora de 07h30/12h30/16h30 BRT; confirmar que a função responde (deploy fantasma
já ocorreu 2×).

**Responsável.** Hub (agente) + deploy (Pedro).

### PROMPT B2

```
PROMPT B2 — Guarda terminal (P0)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS-v1.1.md (CARD B2).
Escopo ÚNICO: constante de status terminais de REQUISIÇÕES em
supabase/functions/sync-compras-status-cron/index.ts (~:492, localizar por conteúdo).
Adicionar 'rejeitada'. Registrar no commit a premissa verificada sobre
pendente_aprovacao/aprovada. Entregar o comando de deploy para o Pedro. Sem deploy.
```

## CARD B3 — ACLs das RPCs (SQL, sem agente)

**Problema e evidência.** CDX-1: `_req_evento`, `submeter_requisicao`,
`aprovar_requisicao`, `rejeitar_requisicao`, `registrar_envio_requisicao` executáveis por
`anon`. As quatro externas têm gate interno (`auth.uid() IS NULL`); **`_req_evento` não tem
gate nenhum** — helper `SECURITY DEFINER` exposta.

**Risco atual.** Alto: escrita direta na trilha de auditoria por chamador anônimo.

**Mudança proposta.** Revogar de `public`+`anon` nas cinco; garantir `authenticated` nas
quatro externas; revogar `_req_evento` **também de `authenticated`** (as RPCs a chamam como
owner).

**Campos intocáveis.** As RPCs do mapa de líderes (já corretas).

**Teste com usuário real.** Ana (líder, não-admin) aprova e rejeita uma requisição de teste
— tem de continuar funcionando.

**Métrica.** `proacl` antes: 5 com `anon`. Depois: 0.

**Rollback.** Regrant (o PREVIEW gera os comandos inversos; guardar a saída).

**Janela.** Qualquer, mas fora de pico de uso da fila.

**Responsável.** Supabase (Pedro).

### SQL B3 — preview → apply → verify

**PREVIEW 1 — gerar os REVOKE com assinatura real:**
```sql
select format('revoke execute on function public.%I(%s) from public, anon;',
       p.proname, pg_get_function_identity_arguments(p.oid)) as cmd
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('_req_evento','submeter_requisicao',
  'aprovar_requisicao','rejeitar_requisicao','registrar_envio_requisicao');
```
**PREVIEW 2 — gerar os GRANT das quatro externas:**
```sql
select format('grant execute on function public.%I(%s) to authenticated;',
       p.proname, pg_get_function_identity_arguments(p.oid)) as cmd
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('submeter_requisicao',
  'aprovar_requisicao','rejeitar_requisicao','registrar_envio_requisicao');
```
**PREVIEW 3 — gerar o REVOKE extra de `_req_evento`:**
```sql
select format('revoke execute on function public.%I(%s) from authenticated;',
       p.proname, pg_get_function_identity_arguments(p.oid)) as cmd
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='_req_evento';
```
**APPLY** — colar a saída dos três previews, nesta ordem (1, 2, 3), e depois:
```sql
NOTIFY pgrst, 'reload schema';
```
**VERIFY** — critério de sucesso: **zero linhas**.
```sql
select p.proname, p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('_req_evento','submeter_requisicao','aprovar_requisicao',
                    'rejeitar_requisicao','registrar_envio_requisicao')
  and (array_to_string(p.proacl,',') like '%anon=%'
    or array_to_string(p.proacl,',') like '%=X/%' and p.proacl is null);
```

## CARD B4 — Auditoria append-only (SQL, sem agente)

**Problema e evidência.** `compras_requisicoes_auditoria` com policy `ALL using(true) with
check(true)` para `authenticated` — a trilha que sustenta auditoria externa é editável e
deletável por qualquer usuário logado.

**Risco atual.** Alto para controle interno: auditoria alterável não é auditoria.

**Mudança proposta.** Trocar por `SELECT` para `authenticated`; `INSERT/UPDATE/DELETE`
revogados (a gravação segue pelas RPCs `SECURITY DEFINER`, que executam como owner).

**Pré-requisitos.** Nome real da policy (PREVIEW).

**Teste com usuário real.** Ana aprova/rejeita → evento aparece na trilha; tentativa de
`delete` via API pelo mesmo usuário → negada.

**Métrica.** Antes: 1 policy ALL. Depois: 1 policy SELECT + zero grants de escrita.

**Rollback.** Recriar a policy ALL (guardar a definição do PREVIEW **antes** do drop).

**Responsável.** Supabase (Pedro).

### SQL B4 — preview → apply → verify

**PREVIEW (guardar esta saída — é o rollback):**
```sql
select polname, cmd, roles, qual, with_check
from pg_policies where schemaname='public'
  and tablename='compras_requisicoes_auditoria';
```
**APPLY** (trocar `<NOME>` pelo polname retornado):
```sql
drop policy "<NOME>" on public.compras_requisicoes_auditoria;
```
```sql
create policy audit_req_select on public.compras_requisicoes_auditoria
  for select to authenticated using (true);
```
```sql
revoke insert, update, delete on public.compras_requisicoes_auditoria from authenticated, anon;
```
```sql
NOTIFY pgrst, 'reload schema';
```
**VERIFY** — sucesso: só a policy de SELECT, e a trilha continua legível na tela.
```sql
select polname, cmd from pg_policies
where schemaname='public' and tablename='compras_requisicoes_auditoria';
```

---

# BLOCO C — Preparação da S1

## CARD C1 — Âncora imutável (D1)

**Problema e evidência.** A âncora "agosto = R$ 1.642.742,28 / 92 pedidos" virou
R$ 1.754.181,16 / 102 — mês aberto. Como anti-regressão, não serve.

**Risco atual.** Falso positivo (pânico de corrupção) e falso negativo (corrupção real
escondida no crescimento).

**Mudança proposta.** Tabela `compras_pedidos_anchor` com snapshot por rodada: IDs + hash
dos 7 campos monetários. `status` fora do hash — muda legitimamente pelo cron.

**Teste com usuário real.** N/A.

**Métrica.** Conferência pós-intervenção retorna **0 linhas**.

**Rollback.** `drop table` (estrutura auxiliar, sem dependências).

**Responsável.** Supabase (Pedro).

### SQL C1 — preview → apply → verify

**APPLY (estrutura):**
```sql
create table if not exists public.compras_pedidos_anchor (
  rodada text not null, pedido_id uuid not null, numero text,
  hash_valores text not null, capturado_em timestamptz not null default now(),
  primary key (rodada, pedido_id));
```
```sql
NOTIFY pgrst, 'reload schema';
```
**PREVIEW (quantas linhas a rodada vai capturar):**
```sql
select count(*) as pedidos_a_congelar from public.compras_pedidos;
```
**APPLY (captura t0 — trocar o rótulo a cada rodada):**
```sql
insert into public.compras_pedidos_anchor (rodada, pedido_id, numero, hash_valores)
select 'S1-t0', id, numero,
  md5(concat_ws('|', valor_total::text, valor_mercadoria::text, valor_servico::text,
      valor_frete::text, valor_desconto::text, valor_ipi::text,
      valor_outras_despesas::text))
from public.compras_pedidos
on conflict do nothing;
```
**VERIFY (rodar após cada intervenção — sucesso: 0 linhas):**
```sql
select p.numero from public.compras_pedidos p
join public.compras_pedidos_anchor a on a.pedido_id=p.id and a.rodada='S1-t0'
where a.hash_valores <> md5(concat_ws('|', p.valor_total::text,
  p.valor_mercadoria::text, p.valor_servico::text, p.valor_frete::text,
  p.valor_desconto::text, p.valor_ipi::text, p.valor_outras_despesas::text));
```

## CARD C2 — Seleção do cron alinhada à contagem

**Problema e evidência.** CDX-2: a contagem em `:1323` inclui terminais com
`detalhes_carregados=false`, mas o SELECT operacional (`:1332-1339`) exclui todos os
terminais. `git show d8edf1c` mostra que 21/07 alterou **só a contagem**.

**Risco atual.** O plano acredita que terminais sem detalhe voltam à fila; eles nunca
voltam. Qualquer métrica de drenagem sai errada e o backfill seria dimensionado errado.

**Mudança proposta.** SELECT passa a incluir terminal com `detalhes_carregados=false` (uma
visita para completar), no padrão `.or()` do CDX-2, atento ao NULL trap do PostgREST.

**Pré-requisitos.** Nenhum. **Vem antes do C3** — corrigir a fila antes de mudar o que ela
processa.

**Campos intocáveis.** Nada de status/valores.

**Métrica antes/depois.** Registrar `elegiveis_sem_limit` × processados de verdade antes e
depois — hoje divergem.

**Rollback.** Redeploy anterior.

**Janela.** Fora das janelas do cron.

**Responsável.** Hub (agente) + deploy (Pedro).

## CARD C3 — S1: rateio + parcelas + cabeçalho (D2, D3)

**Problema e evidência.** D1: `persistirItensPedido` ignora
`ItemPedCompClasseRecdespChildList` — rateio chega e é descartado. D2:
`if (existingPed) continue` congela 11 campos da primeira descoberta (caso 0004664:
R$ 110 mil sem fornecedor). 616 pedidos / R$ 6,64 mi afetados; 277 com parcelas vazias.

**Risco atual.** 57% do gasto sem CC no Hub — inviabiliza a visão por centro de custo que o
gate de líderes existe para controlar.

**Mudança proposta.** (a) RPC transacional `sync_replace_filhos_pedido` restrita a
`service_role` (D2 — nada de UNIQUE); (b) `persistirItensPedido` extrai rateio **e**
parcelas, enriquece labels pelos catálogos locais, dual-write jsonb + normalizado, e liga
`detalhes_carregados` só no sucesso total; (c) bloco "completar ausentes" **antes** do
`if(!mudou)`, preenchendo apenas `null`/`[]`.

**Pré-requisitos.** C1 aplicado e `S1-t0` capturado; C2 deployado; A1 no ar (o open-load
escreve na mesma superfície).

**Campos intocáveis.** `status`, workflow e os **7 campos de valor**. Jamais sobrescrever
campo já preenchido no bloco de completar.

**Teste com usuário real.** Pedro cria um pedido no Alvo (nativo) → após um ciclo, o card no
Hub mostra itens, rateio fechando 100,0000, parcelas e fornecedor.

**Métrica antes/depois.** Cobertura mensal 2026 de rateio/CC/parcelas: hoje ~14%/~36%/~8% →
esperado ≈99% para pedidos novos.

**Rollback.** Redeploy anterior + `delete` dos filhos criados após t0 do ciclo.

**Janela.** Deploy fora das janelas; primeiro ciclo acompanhado.

**Responsável.** Hub (agente escreve o SQL da RPC) + Supabase (Pedro aplica) + deploy (Pedro).

### PROMPT C3

```
PROMPT C3 — S1 do sync (decisões D1, D2, D3)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS-v1.1.md (alertas + BLOCO C) →
MISSAO-SYNC-PEDIDOS.md (§5, conceitual) → relatório CDX-2.
Pré-check obrigatório: confirmar que C1 (âncora S1-t0) e C2 (seleção) já estão
aplicados. Não estando, PARE e reporte.

Escopo: supabase/functions/sync-compras-status-cron/index.ts + UM SQL de saída.
Referência de mapeamento: alvoPedCompLoadService.ts (o mais completo) e
alvoPedCompService.ts:434-463. Lembrar: o open-load é um TERCEIRO escritor da mesma
superfície — o desenho não pode brigar com ele.

Entregas:
1. SQL C3 no formato preview→apply→verify: função
   public.sync_replace_filhos_pedido(p_pedido_id uuid, p_rateios jsonb, p_parcelas jsonb)
   — SECURITY DEFINER, search_path=public, tags $fn$, EXECUTE só para service_role.
   Transacional: valida (rateio fecha 100.0000 por item, 4 casas, residual na última;
   soma de parcelas == referência quando fornecida) → apaga filhos dos itens do pedido →
   reinsere → retorna contagens. Corpo escrito a partir do schema REAL (MCP: colunas,
   FKs e CHECKs antes de escrever).
2. persistirItensPedido: upsert de itens retornando (id, sequencia); extrair
   ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[] e
   ParcPagPedCompChildList; enriquecer labels de classe/CC pelos catálogos locais;
   chamar a RPC via service client; dual-write dos jsonb (classe_rateio, itens,
   parcelas) + primeiro_vencimento; detalhes_carregados=true SÓ no sucesso total.
3. Bloco "completar ausentes" ANTES do if(!mudou): só null/[] em centro_custo,
   classe_rec_desp, classe_rateio, itens, parcelas, primeiro_vencimento, nome_cond_pag,
   cnpj_entidade, nome_entidade (fallback pela entidade — caso 0004664).
   NUNCA status/workflow/7 valores.
Entrega: diff + SQL em blocos + roteiro do GATE C. Sem deploy.
```

**GATE C (não passa para o Bloco E sem tudo verde):** função responde · 1 ciclo real
completo · `sync_runs` sem falha · pedido novo do Alvo entra completo · 2º ciclo **sem
duplicação** de rateio/parcelas · **VERIFY da âncora `S1-t0` retorna 0 linhas**.

---

# BLOCO D — Endurecimento da criação

*(Pode correr em paralelo ao Bloco C — superfícies distintas —, respeitada a regra 11: uma
sessão de execução por vez.)*

## CARD D1 — Invariantes no serviço + erros que gritam

**Problema e evidência.** CDX-4: erros de `insert` de rateio, parcelas e auditoria são
ignorados (sem checar `error`); `envio_tentado` grava `sucesso=true` **antes** do POST;
200 sem `Numero` não é rejeitado; anexos clonados da requisição não reaplicam validação de
MIME/tamanho; não há validação de 255.

**Risco atual.** Pedido meio-gravado sem ninguém saber; auditoria que mente; recusa do Alvo
na ponta (255) em vez de aviso na digitação.

**Mudança proposta.** Validar antes de enviar (≥1 item, ≥1 parcela, soma exata, rateio
completo, observação ≤255, anexos ≤3/≤5MB/MIME — inclusive clonados); checar **todo**
`error`; `envio_tentado` com `sucesso=false` até a resposta; 200 sem `Numero` → estado
indeterminado (D3).

**Campos intocáveis.** Ordem do enriquecimento fiscal; `CodigoComprador=null`;
`resolverUsuarioAlvo` por `user_id`.

**Teste com usuário real.** Operadora cria pedido válido (sai normal) e força cada violação
(mensagem clara, nada meio-gravado além do rascunho).

**Métrica.** Antes: N pontos sem checagem de erro (contar no diff). Depois: 0.

**Rollback.** Reverter commit.

**Responsável.** Hub (agente).

## CARD D2 — Anexos na retomada

**Problema e evidência.** CDX-4 achado 2: em retomada, `limparFilhosDoPedido` apaga arquivos
do Storage; o wizard só reenvia arquivos novos (`arquivosExistentes` não entra no
`NovoPedidoInput`). Anexo que o usuário vê na tela some no reenvio.

**Risco atual.** Perda silenciosa de documento fiscal/orçamento anexado.

**Mudança proposta.** Preservar por padrão; apagar só o que o usuário removeu explicitamente;
limite de 3 no **total** (existentes + novos).

**Teste com usuário real.** Criar com 2 anexos → forçar falha → reabrir → reenviar sem tocar
nos anexos → pedido no Alvo com os 2.

**Métrica.** Antes: 100% de perda no cenário. Depois: 0.

**Responsável.** Hub (agente).

## CARD D3 — Idempotência (D8)

**Problema e evidência.** CDX-4 achado 1: se o ERP aceita e a resposta se perde, o Hub marca
`erro_envio`; retry cria **pedido duplicado** no Alvo. Sem idempotency key, sem reconciliação.

**Risco atual.** Duplicidade de compra — impacto financeiro direto.

**Mudança proposta.** uuid do pedido do Hub gravado em campo livre do
`PedCompUserFieldsObject`; falha ambígua → `envio_indeterminado`; **reconciliar antes de
qualquer retry** (achou o uuid no ERP → adota `Numero`, não reenvia).

**Pré-requisitos.** SQL D3 (novo valor no enum) + **Pedro validar no Alvo** qual campo livre
persiste e retorna.

**Teste com usuário real.** Simular resposta perdida → estado indeterminado → retry
reconcilia e não duplica.

**Rollback.** Reverter código; o valor do enum pode ficar (aditivo, inofensivo).

**Responsável.** Hub (agente) + Supabase (Pedro) + validação no Alvo (Pedro).

### SQL D3 — apply → verify
```sql
alter type public.compras_pedido_status_local add value if not exists 'envio_indeterminado';
```
```sql
NOTIFY pgrst, 'reload schema';
```
```sql
select unnest(enum_range(null::public.compras_pedido_status_local));
```

## CARD D4 — Normalização de parcelas e rateio no payload

**Problema e evidência.** CDX-4 invariante (d): residual de parcelas só existe em
`calcularParcelas`; edição manual passa direto (tolerância de R$ 0,01 chega ao Alvo). Residual
do rateio é aplicado no agregado, **não** no rateio interno de cada item.

**Risco atual.** Recusa do Alvo ("soma != total") na ponta e divergência Hub × payload.

**Mudança proposta.** Recalcular última parcela = total − anteriores no
`montarPayloadPedComp`; residual também por item; persistir os valores normalizados.

**Teste com usuário real.** Pedido 3×33,33% com 3 parcelas quebradas → Alvo aceita sem ajuste
manual.

**Responsável.** Hub (agente).

## CARD D5 — 255 na digitação

**Mudança proposta.** `maxLength=255` + contador na observação de item, nos wizards de pedido
e de requisição, com bloqueio no avanço. (A validação de serviço já entrou no D1.)

**Métrica.** Ocorrências de `rascunho (erro)` por observação longa: hoje ≥2 registradas →
esperado 0.

**Responsável.** Hub (agente).

---

# BLOCO E — Data-fix (só após GATE C)

Separado, como o agente sugeriu, em quatro coisas distintas:

- **E1 — Drenagem automática.** Com C3 no ar, o próprio cron completa o que visita. Medir a
  curva por 2–3 dias antes de qualquer disparo manual: parte do "buraco" some sozinha.
- **E2 — Backfill dirigido.** Só o que a drenagem não alcança (terminais fora da janela de
  31 dias, pedidos antigos de 2026). Modo `?modo=backfill&lote=25` **na própria Edge**,
  reusando o `persistirItensPedido` novo — zero código paralelo. Âncora
  `S2-<lote>-t0` antes de cada janela; 404 em `excluido_alvo`: logar e seguir.
- **E3 — Reconciliação final.** Refazer a medição §C1.5 do `DISCOVERY-FASE7A.md`; cobertura
  2026 ≈99%; âncoras intactas; relatório de gasto por CC comparável ao de 14/08.

**Rollback (E2).** `delete from compras_pedidos_itens_rateio/parcelas where created_at >= t0`
do lote + limpeza dos campos preenchidos na janela.

**Responsável.** Hub (agente) + operação (Pedro).

---

# BLOCO F — Dívidas

- **F0 (imediato, 5 min, Pedro/GitHub Web):** remover `"Produto/SavePartial"` da whitelist do
  passthrough (vencido desde 30/07); conferir se `intercompany-mcp` e `suprimentos-mcp` têm
  auth interna — se algum não tiver, sobe para P0; clicar no sync de `cost_centers` como
  paliativo (congelado há ~7 dias).
- **F1 — Escrita direta em Notas de Serviço** (`MovEstq/SaveMultiPart` do navegador):
  checklist de rota nova no proxy → migração dos dois services. P0 da migração.
- **F2 — ApiTester** admin-only via passthrough (D7).
- **F3 — `cost_centers`**: fase 1 passthrough (`CentroCusto/GetRegistros` **já está na
  whitelist** — zero mudança no proxy); fase 2 Edge + cron + `sync_runs` + alerta de idade.
- **F4 — Migração por etapas (D6):** NF Entrada → Contas a Pagar → Sales, um prompt por
  etapa, cada uma com seu checklist de rotas.
- **F5 — Descomissionar credenciais (D9):** só quando o inventário do CDX-3 zerar (incluindo
  download de anexos, que precisa de rota própria); remover campos de senha, remover
  `alvoService.ts`, limpar chaves locais, **rotacionar a senha do ERP**.
- **F6 — Higiene:** aposentar as 5 Edges fósseis (pré-check no Make); remover `SYNC_TEST.md`;
  KPIs no bloco "No gate" (D5), recriando a RPC a partir do `pg_get_functiondef`.

---

## Pendências registradas (não bloqueiam)

1. **Flags de completude** — quebrar `detalhes_carregados` em `itens_carregados`,
   `parcelas_carregadas`, `rateio_carregado`, `anexos_carregados`. Dívida nova, nasce do
   alerta 3; fazer **depois** do GATE C, com a semântica já estabilizada.
2. **Ryan — `funcionario_alvo_codigo`:** banco `0000063` × roster `0000153`. Conferir no Alvo.
3. **RLS ampla** de `compras_requisicoes`/`compras_pedidos` — missão própria (blast radius
   grande; trigger + auditoria append-only seguram o gate até lá).
4. **Edge `notify-aprovador-budget`** — endurecer autorização (é de Projetos/Budget, não do
   líder de CC).
5. **MOEDA-PEDIDOS** — missão própria; o D4 não a invade.
6. **Aposentadoria dos jsonb** — após S1/S2 estáveis e telas migradas.
7. **Cobertura de líderes** (66 CCs) — trabalho organizacional, paralelo.

---

*Fim do plano v1.1. Ordem: A1 → A2 → B1..B4 → C1 → C2 → C3 → GATE C → D1..D5 → E1..E3 →
F0..F6 (F0 imediato). Prompts imutáveis; ajustes viram AJUSTE-RS-x.md.*
