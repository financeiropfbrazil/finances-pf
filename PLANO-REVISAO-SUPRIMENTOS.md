# PLANO-REVISAO-SUPRIMENTOS — v1.0 (17/08/2026)
## As 4 frentes: Aprovação do Líder · Sync de Pedidos · Gateway/Autenticação · Núcleo de Criação

> **Base factual:** relatórios CDX-1..4 (Codex, 17/08/2026, leitura pura) + código real do
> erp-proxy (index, alvo-auth, alvo passthrough, ped-comp, req-comp) + decisões do Pedro de
> 17/08. **Este plano NÃO altera a MISSAO-SYNC-PEDIDOS.md** — ele registra os ajustes dela
> (âncora, UNIQUE→RPC, parcelas na S1) como decisões novas, mantendo a spec original intacta.
> **Escrito para sessão nova, sem contexto prévio.** Execução: sessões Claude Code (um PROMPT
> por sessão, na ordem), SQL colado pelo Pedro no SQL Editor, erp-proxy editado SÓ pelo Pedro
> via GitHub Web, deploy de Edge pelo Pedro via CLI fora das janelas do cron.

---

## 0. Decisões registradas (17/08/2026) — valem para todo o plano

| # | Decisão |
|---|---|
| D1 | **Âncora de reconciliação** deixa de ser "total de agosto" (mês aberto = número móvel). Vira **coorte congelada por rodada**: snapshot de IDs + hash dos **7 campos monetários** (sem `status`, que muda legitimamente pelo cron) capturado em t0 antes de cada intervenção e conferido depois. |
| D2 | **Sem UNIQUE simples no rateio** — repetição (item, classe, CC) é legítima (ex.: 25+25+50). Reprocesso via **RPC transacional restrita a `service_role`**: valida → apaga os filhos dos pedidos processados → reinsere, na mesma transação. |
| D3 | **Parcelas entram na S1** — mesmo Load, custo marginal zero, cobre os 277 pedidos descobertos com `detalhes_carregados=true` e parcelas vazias. |
| D4 | **Detalhe do líder**: líder enxerga requisições do CC que lidera **exceto rascunho alheio**. |
| D5 | **KPIs**: pendentes/rejeitadas saem dos totais de fluxo ERP e viram **bloco próprio "No gate"**. |
| D6 | **Ordem de migração pós-open-load**: escrita direta (Notas de Serviço) é P0 imediato; depois **NF Entrada → Contas a Pagar → Sales**. |
| D7 | **ApiTester**: mantém, **admin-only**, transporte via `/alvo/passthrough` (endpoints fora da whitelist → 403, comportamento aceito do laboratório). |
| D8 | **Idempotência do envio**: gravar o **id (uuid) do pedido do Hub** num campo livre do `PedCompUserFieldsObject` e **reconciliar antes de qualquer retry** (busca no ERP; se achou, adota o `Numero`, não reenvia). Sem dependência de mudança no Alvo. |
| D9 | **Higiene**: aposentar as 5 Edges fósseis (`alvo-auth`, `alvo-proxy`, `alvo-sync-worker`, `proxy-test`, `erp-health-check`) e **rotacionar a senha do ERP** distribuída aos navegadores ao final da migração. |

---

## 1. Regras de engajamento (todas as sessões deste plano)

1. `git pull --ff-only` antes de tudo. Falhou → parar e reportar (nunca stash automático).
2. **MCP Supabase é read-only.** Toda escrita (DDL/DML) é do Pedro, no SQL Editor. SQL
   necessário → escrever em bloco no chat/arquivo de saída, nunca executar.
3. Tags nomeadas (`$fn$`, `$r1$`…) em todo `CREATE FUNCTION` (o SQL Editor corrompe `$$`).
4. `text` não é domínio livre — conferir **CHECK constraint** antes de valor novo.
5. `CREATE OR REPLACE` não preserva `SECURITY DEFINER`/`search_path` — recriar sempre a
   partir do `pg_get_functiondef` do banco, redeclarando os dois.
6. `revoke execute` precisa dos DOIS: `from anon` **e** `from public`.
7. Staging explícito, proibido `git add -A`/`.`; `types.ts` em skip-worktree; commit sem
   push sem autorização; **Publicar no Lovable é do Pedro**.
8. Edge Function: deploy via CLI `--project-ref hbtggrbauguukewiknew`, **fora das janelas
   do cron (07h30 / 12h30 / 16h30 BRT)**, confirmar que responde (deploy fantasma já
   ocorreu 2×) e conferir `sync_runs` no ciclo seguinte.
9. **erp-proxy é OFF-LIMITS para agentes.** Alterações = checklist para o Pedro aplicar no
   GitHub Web (Render auto-deploya).
10. Fallback nunca silencioso; anti-wipe absoluto: nada toca `status` nem os 7 campos de
    valor de `compras_pedidos` fora dos caminhos legítimos do cron.
11. Uma tarefa por vez. Prompt executado e validado antes do próximo. Prompts são
    imutáveis — mudança = arquivo `AJUSTE-RS-x.md` novo.

---

## 2. Sequência mestre

```
BLOCO A — Destravar operação e fechar buracos de segurança (imediato)
  SQL-A1 (Pedro) → E0 (Pedro, GitHub Web) → PROMPT A2 → PROMPT A3 → PROMPT A5
BLOCO B — Âncora + correção do sync (S1)
  SQL-B1 (Pedro) → PROMPT B2 (gera SQL-B3 final) → SQL-B3 (Pedro) → deploy → GATE B
BLOCO C — Backfill dirigido 2026 (S2)               [só após GATE B]
BLOCO D — Núcleo de criação (pedidosService)         [pode iniciar após BLOCO A]
BLOCO E — Rollout do gateway e descomissionamento    [E0 imediato; E1+ após A3]
```

Blocos B/C (cron) e D (pedidosService) tocam superfícies diferentes e podem intercalar,
mas **nunca duas sessões de execução simultâneas** — a regra 11 vale globalmente.

---

## BLOCO A — Imediato

### SQL-A1 (Pedro cola no SQL Editor) — ACLs + auditoria append-only

**Passo 1 — gerar os revokes com assinatura real** (rodar, copiar a saída, colar de volta):

```sql
select format(
  'revoke execute on function public.%I(%s) from public, anon;',
  p.proname, pg_get_function_identity_arguments(p.oid))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('_req_evento','submeter_requisicao','aprovar_requisicao',
                    'rejeitar_requisicao','registrar_envio_requisicao');
```

**Passo 2 — garantir o EXECUTE de quem deve ter** (mesma técnica):

```sql
select format(
  'grant execute on function public.%I(%s) to authenticated;',
  p.proname, pg_get_function_identity_arguments(p.oid))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('submeter_requisicao','aprovar_requisicao',
                    'rejeitar_requisicao','registrar_envio_requisicao');
```

**Passo 3 — `_req_evento` é helper interna**: revogar TAMBÉM de `authenticated` (as RPCs
SECURITY DEFINER continuam chamando-a como owner):

```sql
select format(
  'revoke execute on function public.%I(%s) from authenticated;',
  p.proname, pg_get_function_identity_arguments(p.oid))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='_req_evento';
```

**Passo 4 — auditoria append-only.** Inspecionar antes (regra 5 — nomes reais):

```sql
select polname, cmd, roles from pg_policies
where schemaname='public' and tablename='compras_requisicoes_auditoria';
```

Depois, com o nome real da policy ALL no lugar do placeholder:

```sql
drop policy "<NOME_DA_POLICY_ALL>" on public.compras_requisicoes_auditoria;
```
```sql
create policy audit_req_select on public.compras_requisicoes_auditoria
  for select to authenticated using (true);
```
```sql
revoke insert, update, delete on public.compras_requisicoes_auditoria
  from authenticated, anon;
```
```sql
NOTIFY pgrst, 'reload schema';
```

**Validação:** repetir a query de `proacl` do CDX-1 → nenhuma das 5 executável por
anon/public; `_req_evento` nem por authenticated. Testar na tela: aprovar/rejeitar segue
funcionando (RPCs são SECURITY DEFINER). A trilha continua legível no Hub.

### E0 (Pedro, GitHub Web no erp-proxy — 5 minutos)

1. Remover `"Produto/SavePartial"` da whitelist de `src/routes/alvo.ts` (vencido desde 30/07).
2. Conferir se `src/routes/intercompany-mcp.ts` e `suprimentos-mcp.ts` têm autenticação
   **interna** (secret/OAuth). Se algum não tiver, me mandar os dois arquivos aqui — viram
   item de correção antes de qualquer outra coisa do Bloco E.
3. Paliativo `cost_centers`: um clique no botão de sincronizar em /settings/cost-centers
   (espelho congelado há ~7 dias). A solução definitiva é E3.

### PROMPT A2 — Fix do detalhe do líder (colar na sessão Claude Code)

```
PROMPT A2 — Detalhe do líder (P0, decisão D4)
Leia CLAUDE.md (protocolo de sessão) e a §BLOCO A do PLANO-REVISAO-SUPRIMENTOS.md.

Escopo ÚNICO: src/pages/SuprimentosRequisicaoDetalhe.tsx.
O controle de escopo (~:143-165) retorna null antes de considerar líder; isLiderDoCC
(~:242-256) depende de req já carregada. Corrigir com consulta a compras_lideres_cc
ANTES do return null, no padrão validado no CDX-1:
  - isLider = existe linha ativa em compras_lideres_cc com codigo_centro_ctrl da
    requisição e lider_user_id = user.id (verificar nomes reais das colunas via MCP
    antes de escrever — regra 4/5);
  - decisão D4: se isLider e data.status === 'rascunho' e não é owner/funcionário,
    continua bloqueado (líder não vê rascunho alheio);
  - liberar apenas owner || funcionário || (líder ativo do CC exato, fora de rascunho).
Não tocar em mais nada (fila, RPCs, App.tsx — a rota já cobre o caso).
Entrega: diff + build ok + push com staging explícito do arquivo único (sem Publicar).
Validação (Pedro): logar como líder sem is_admin → abrir pendência da fila → detalhe
carrega; abrir rascunho de terceiro do mesmo CC → bloqueado.
```

### PROMPT A3 — Migração do open-load para o gateway (caso Mirlene)

```
PROMPT A3 — Open-load via erp-proxy (P0)
Leia CLAUDE.md e a §BLOCO A do PLANO-REVISAO-SUPRIMENTOS.md.

Escopo ÚNICO: src/services/alvoPedCompLoadService.ts (e o mínimo indispensável em
SuprimentosPedidoDetalhe.tsx se a assinatura mudar).
Trocar o transporte do fetchLoadWithRetry: de authenticateAlvo()+Alvo direto para
GET {ERP_PROXY_URL}/ped-comp/{codigo_empresa_filial}/{numero} com
Authorization: Bearer <JWT da sessão Supabase> (reusar a constante/env de proxy que os
services já migrados usam — localizar, não inventar). Filial vem do pedido, não
hardcoded. Preservar:
  - guarda anti-wipe cliente por Numero (redundância intencional — o proxy já tem a dele);
  - semântica de "não encontrado": via proxy só existe 404 (a máscara 412→regex vive lá);
    isPedidoInexistenteNoAlvo continua aceitando ambos;
  - 404 isolado NUNCA marca excluido_alvo (regra do cross-check);
  - 502/erro → PedCompLoadError sem nenhuma escrita (snapshot local permanece).
Remover o import de authenticateAlvo DESTE service apenas. NÃO tocar no download de
anexos (segue direto por ora — Bloco E) nem em alvoService.ts (outros consumidores).
Entrega: diff + build + push (staging explícito). Validação (Pedro): Publicar; Mirlene
abre um pedido → sem toast de erro, status/itens atualizam; DevTools sem
"Falha na autenticação ERP".
```

### PROMPT A5 — `rejeitada` na guarda terminal do cron

```
PROMPT A5 — Guarda anti-rebaixamento (P0)
Leia CLAUDE.md e a §BLOCO A do PLANO-REVISAO-SUPRIMENTOS.md.

Escopo ÚNICO: supabase/functions/sync-compras-status-cron/index.ts, constante de
status terminais de REQUISIÇÕES (~:492 — localizar por conteúdo). Adicionar 'rejeitada'
ao conjunto (pendente_aprovacao/aprovada não entram: sem numero_alvo, nunca casam com o
list — confirmar essa premissa por leitura e registrar no commit).
Entrega: diff + comando de deploy pronto para o Pedro:
  supabase functions deploy sync-compras-status-cron --project-ref hbtggrbauguukewiknew
Pedro executa FORA das janelas (07h30/12h30/16h30 BRT), confirma que a função responde
e confere sync_runs no ciclo seguinte (falha aqui é silenciosa).
```

---

## BLOCO B — Âncora + S1 do sync

### SQL-B1 (Pedro) — infraestrutura da âncora por rodada (decisão D1)

```sql
create table if not exists public.compras_pedidos_anchor (
  rodada       text not null,
  pedido_id    uuid not null,
  numero       text,
  hash_valores text not null,
  capturado_em timestamptz not null default now(),
  primary key (rodada, pedido_id)
);
```
```sql
NOTIFY pgrst, 'reload schema';
```

**Captura de t0 (template — trocar o rótulo da rodada a cada uso):**

```sql
insert into public.compras_pedidos_anchor (rodada, pedido_id, numero, hash_valores)
select 'S1-t0', id, numero,
       md5(concat_ws('|', valor_total::text, valor_mercadoria::text,
           valor_servico::text, valor_frete::text, valor_desconto::text,
           valor_ipi::text, valor_outras_despesas::text))
from public.compras_pedidos
on conflict do nothing;
```

**Conferência pós-intervenção (tem que retornar 0 linhas):**

```sql
select p.numero
from public.compras_pedidos p
join public.compras_pedidos_anchor a
  on a.pedido_id = p.id and a.rodada = 'S1-t0'
where a.hash_valores <> md5(concat_ws('|', p.valor_total::text,
      p.valor_mercadoria::text, p.valor_servico::text, p.valor_frete::text,
      p.valor_desconto::text, p.valor_ipi::text, p.valor_outras_despesas::text));
```

### PROMPT B2 — Correção S1 do sync (rateio + parcelas + cabeçalho)

```
PROMPT B2 — S1 do sync de pedidos (decisões D1, D2, D3)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§0 e §BLOCO B) → MISSAO-SYNC-PEDIDOS.md
(§5, referência conceitual) → relatório CDX-2 (achados que ajustam a spec).

Escopo: supabase/functions/sync-compras-status-cron/index.ts + UM SQL de saída (a RPC).
Referências de mapeamento: alvoPedCompLoadService.ts (o loader mais completo) e
alvoPedCompService.ts:434-463. Nada de editar services do frontend nesta sessão.

Entregas, nesta ordem:
1. SQL-B3 FINAL: função public.sync_replace_filhos_pedido(p_pedido_id uuid,
   p_rateios jsonb, p_parcelas jsonb) — SECURITY DEFINER, search_path=public, tags $fn$,
   EXECUTE revogado de public/anon/authenticated e concedido só a service_role.
   Comportamento transacional: valida (percentual do rateio fecha 100.0000 por item com
   4 casas e residual na última linha; soma de parcelas == valor de referência quando
   fornecido) → apaga rateios dos itens do pedido e parcelas do pedido → reinsere →
   retorna contagens. Escrever o corpo a partir do schema REAL (MCP; conferir CHECKs e
   colunas de compras_pedidos_itens_rateio e compras_pedidos_parcelas antes).
2. Cron — seleção alinhada à contagem: terminais com detalhes_carregados=false entram
   na fila (uma visita para completar), no padrão .or() do CDX-2. Conferir a armadilha
   PostgREST de NULL.
3. Cron — persistirItensPedido: upsert de itens retornando (id, sequencia); extrair
   ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[]; enriquecer labels
   de classe/CC pelos catálogos locais; montar p_rateios e p_parcelas
   (ParcPagPedCompChildList) e chamar a RPC via service client; gravar também o jsonb
   parcelas + primeiro_vencimento (dual-write da transição, como classe_rateio);
   detalhes_carregados=true SÓ após sucesso total.
4. Cron — bloco "completar ausentes" ANTES do if(!mudou): preencher apenas null/[] de
   centro_custo, classe_rec_desp, classe_rateio, itens, nome_cond_pag,
   primeiro_vencimento, cnpj_entidade e nome_entidade (fallback pela entidade — caso
   0004664). NUNCA tocar status/workflow/7 campos de valor.
Entrega: diff completo + SQL-B3 em bloco para o Pedro + roteiro do GATE B. Sem deploy
(Pedro deploya após aplicar o SQL-B3 e capturar a âncora S1-t0).
```

**Ordem de aplicação do Bloco B (Pedro):** SQL-B1 → captura `S1-t0` → SQL-B3 → deploy da
Edge fora de janela → **GATE B**.

**GATE B (sai do Bloco B só com tudo verde):** função responde · 1 ciclo real completo ·
`sync_runs` sem falha · pedido novo nascido no Alvo entra **completo** (itens + rateio
fechando 100,0000 + parcelas + cabeçalho) · 2º ciclo (reprocesso) **sem duplicação** ·
conferência da âncora `S1-t0` retorna **0 linhas**.

---

## BLOCO C — Backfill dirigido 2026 (S2)

### PROMPT C1 — Backfill (só após GATE B)

```
PROMPT C1 — Backfill 2026 (S2)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§BLOCO C) → MISSAO-SYNC-PEDIDOS.md (§6).

1. Recontar o universo AGORA via MCP (o número da spec envelheceu): pedidos 2026,
   criado_no_hub=false, sem rateio e/ou sem parcelas — separar os que também não têm
   itens (mesmo Load serve para tudo).
2. Implementar modo backfill NA PRÓPRIA Edge sync-compras-status-cron
   (?modo=backfill&lote=25&cursor=..., gate x-cron-secret), reusando o
   persistirItensPedido novo — zero código paralelo. Lotes de ~25 Loads com pausa.
3. Roteiro operacional para o Pedro: capturar âncora 'S2-<lote>-t0' antes de cada
   janela, disparar fora das janelas do cron, conferir âncora e cobertura após cada
   lote. 404 nos excluido_alvo: logar e seguir (404 isolado não prova exclusão).
4. Rollback documentado: delete de rateio/parcelas com created_at >= t0 do lote +
   limpeza dos campos preenchidos na janela.
Validação final: cobertura mensal 2026 de rateio/CC/parcelas ≈ 99% · âncoras intactas ·
refazer a medição §C1.5 do DISCOVERY-FASE7A.md e comparar.
```

---

## BLOCO D — Núcleo de criação (pedidosService.ts)

### PROMPT D1 — Invariantes no serviço + erros que gritam

```
PROMPT D1 — Invariantes do enviarPedido (P0)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§BLOCO D) → relatório CDX-4.

Escopo: src/services/pedidosService.ts (+ requisicoesService.ts SÓ no item de 255).
1. Validações ANTES de criar/enviar (erro claro na UI, não silencioso): ≥1 item; ≥1
   parcela; soma de parcelas == valor total EXATA pós-normalização; rateio completo
   (100% e valor total); observação de item ≤255 (pedido E requisição); anexos ≤3,
   ≤5MB, MIME permitido — REAPLICADAS aos anexos clonados da requisição.
2. Conferir TODOS os {error} dos inserts/upserts hoje ignorados (rateio, parcelas,
   auditoria, marcações) — falhou, grita e interrompe coerentemente.
3. Auditoria honesta: envio_tentado registra sucesso=false (ou null) ANTES do POST;
   sucesso=true só com resposta contendo Numero.
4. Resposta 200 sem Numero deixa de ser tratada como sucesso: cai no estado
   indeterminado do D3 (por ora: erro_envio com marcação própria no jsonb).
Entrega: diff + build + push. Validação (Pedro): criar pedido válido → sai normal;
forçar cada violação → mensagem clara e nada meio-gravado além do rascunho.
```

### PROMPT D2 — Retomada sem perder anexos

```
PROMPT D2 — Anexos na retomada (P0)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§BLOCO D) → CDX-4 (achado 2).

Escopo: pedidosService.ts (limparFilhosDoPedido / retomada) + SuprimentosPedidoNovo.tsx.
Regra nova: na retomada de erro_envio, anexos existentes são PRESERVADOS por padrão;
apagar do Storage apenas o que o usuário removeu explicitamente. Incluir
arquivosExistentes no fluxo (NovoPedidoInput ou recarga como File — escolher o que
preservar a semântica do multipart com menos mudança). O envio final referencia
existentes + novos, respeitando o limite de 3 no TOTAL.
Validação (Pedro): criar pedido com 2 anexos → forçar falha de envio → reabrir →
reenviar sem tocar em anexos → pedido no Alvo com os 2 anexos.
```

### SQL-D3 (Pedro) — estado indeterminado

```sql
alter type public.compras_pedido_status_local add value if not exists 'envio_indeterminado';
```
```sql
NOTIFY pgrst, 'reload schema';
```

### PROMPT D3 — Idempotência do envio (decisão D8)

```
PROMPT D3 — Envio sem duplicação
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§0 D8, §BLOCO D) → CDX-4 (achado 1).

Escopo: pedidosService.ts (+ statusPedido.ts para o novo estado).
1. Descoberta primeiro: inspecionar payloads reais de PedComp/Load (gabaritos 0004635/
   0004636 + um Load atual via dados persistidos) e listar os campos livres de
   PedCompUserFieldsObject que o Alvo persiste e devolve. PROPOR o campo para carregar
   o uuid do Hub — Pedro valida no Alvo antes do uso.
2. montarPayloadPedComp passa a gravar o uuid do pedido do Hub no campo escolhido.
3. Falha ambígua (timeout/sem resposta/200 sem Numero) → status_local =
   'envio_indeterminado' (SQL-D3 já aplicado).
4. Reconciliação antes de QUALQUER retry de erro_envio/envio_indeterminado: buscar no
   ERP (by-req quando houver requisição; senão /ped-comp/list na janela do dia) um
   pedido carregando o uuid → achou: adotar Numero, marcar enviado_alvo, NÃO reenviar;
   não achou: reenvio liberado.
5. statusPedido.ts: 'Envio indeterminado' como estado visível com precedência junto de
   erro_envio (badge + filtro na MESMA função, regra L4).
Validação (Pedro): simular resposta perdida → pedido fica indeterminado → retry
reconcilia e NÃO duplica no Alvo.
```

### PROMPT D4 — Normalização de parcelas e rateio no payload

```
PROMPT D4 — Fechamento exato no payload
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§BLOCO D) → CDX-4 (invariante d, achado 9).

Escopo: pedidosService.ts.
1. montarPayloadPedComp recalcula a ÚLTIMA parcela = total − soma das anteriores
   (mesmo com edição manual; a tolerância de R$0,01 da UI não pode chegar ao payload).
2. Residual do rateio aplicado TAMBÉM no rateio interno de cada item, não só no
   agregado do pedido.
3. Persistir no Hub os valores normalizados (o que foi ao Alvo == o que está no banco).
4. Enriquecimento fiscal: propagar o tipo do item (serviço vs produto) em vez de
   ItemServico:"Não" fixo — se o DTO não carrega a informação, incluir; se o impacto
   for maior que o escopo, registrar como dívida com evidência e não implementar.
Validação (Pedro): pedido 3×33,33% e 3 parcelas quebradas → Alvo aceita sem ajuste
manual; valores no Hub batem com o payload.
```

### PROMPT D5 — 255 na digitação (UI)

```
PROMPT D5 — Limite 255 nos wizards
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§BLOCO D).
Escopo: SuprimentosPedidoNovo.tsx + wizard de requisição (SuprimentosRequisicaoNova).
maxLength=255 + contador visível na observação de ITEM; bloqueio no avanço/salvar do
item. (A validação de serviço já entrou no D1 — aqui é só a camada de digitação, para
o erro nunca mais nascer.)
```

---

## BLOCO E — Rollout do gateway e descomissionamento

*(E0 está no Bloco A — imediato.)*

### PROMPT E1 — Fim da escrita direta (Notas de Serviço)

```
PROMPT E1 — SaveMovEstq via gateway (P0)
Leia CLAUDE.md → PLANO-REVISAO-SUPRIMENTOS.md (§BLOCO E) → CDX-3.

1. Levantar no código o payload EXATO da escrita direta atual
   (alvoMovEstqLancarService / alvoMovEstqLancarNfeService — MovEstq/SaveMultiPart).
2. Produzir o CHECKLIST-PROXY-E1 para o Pedro (GitHub Web): endpoint novo no router
   src/routes/movEstq.ts — POST /mov-estq/insert-multipart, espelhando o padrão do
   ped-comp (multer 3×5MB, obj + arquivos, repasse com action=Insert, tratamento de
   erro 4xx/5xx). Especificar campo a campo com base no payload levantado.
3. Após o Pedro aplicar e o Render deployar: trocar o transporte dos dois services
   para a rota nova (JWT Supabase), removendo o caminho direto.
Validação (Pedro): lançar uma NFS-e/NF real de teste → movimento criado no Alvo →
nenhuma chamada a pef.it4you no DevTools.
```

### PROMPT E2 — ApiTester admin-only via passthrough (decisão D7)

```
PROMPT E2 — Laboratório contido
Escopo: ApiTester (localizar página/rota) + App.tsx.
Gate is_admin na rota e na UI; transporte trocado para POST /alvo/passthrough
(endpoint+method+payload). Fora da whitelist → exibir o 403 do gateway como resposta
normal do laboratório. Remover qualquer uso de credencial local no componente.
```

### PROMPT E3 — cost_centers definitivo

```
PROMPT E3 — Espelho de CCs sem congelar
Fase 1 (frontend): trocar o sync de /settings/cost-centers para POST /alvo/passthrough
com CentroCusto/GetRegistros (JÁ está na whitelist — zero mudança no proxy).
Fase 2 (server-side): Edge sync-cost-centers-cron chamando o passthrough com
X-System-Secret, upsert no espelho, registro em sync_runs; cron pg_cron diário fora
dos horários dos demais (sugestão 0 21 * * 1-5 UTC), secret via Vault, verify_jwt=false
no config.toml. Entregar SQL do cron para o Pedro + comando de deploy.
Validação: espelho atualiza sem clique; sync_runs acusa; idade some da tela de líderes.
```

### PROMPT E4 — Migração por etapas (decisão D6): NF Entrada → Contas a Pagar → Sales

```
PROMPT E4-<etapa> — um prompt POR ETAPA, executado em sessões separadas.
Para a etapa corrente: mapear os services/telas envolvidos (CDX-3 tem o inventário),
produzir o CHECKLIST-PROXY da etapa (rotas da tabela CDX-3 que faltarem: movestq
load/list, docfin/:filial/:chave, contas-pagar/list, nota-fiscal-trans/list,
funcionario/list, cond-pag/... — só as da etapa), aguardar o Pedro aplicar, trocar o
transporte, validar tela a tela. Preferir whitelist do passthrough para leituras
simples; rota dedicada para escrita ou multipart.
```

### PROMPT E5 — Descomissionamento das credenciais (decisão D9)

```
PROMPT E5 — Fim do localStorage (só quando o inventário CDX-3 zerar)
1. Confirmar por grep que nenhum consumidor direto restou (incluindo download de
   anexos — que ganhou rota própria no E4/checklist: POST /ped-comp/download-file).
2. Remover campos de credencial da UI de Settings; remover alvoService.ts; código de
   limpeza das chaves alvo_* no login (uma release de transição).
3. Roteiro para o Pedro: rotacionar a senha do usuário ERP que estava nos navegadores.
   (A conta de serviço do Render tem env própria e não muda.)
```

### PROMPT E6 — Higiene final

```
PROMPT E6 — Fósseis e sobras
1. Remover do repo as 5 Edges fósseis (alvo-auth, alvo-proxy, alvo-sync-worker,
   proxy-test, erp-health-check) + entradas correspondentes do config.toml.
   Pré-check de 1 minuto (Pedro): confirmar no Make que nenhum cenário as referencia.
2. Remover SYNC_TEST.md (pendência FH47 §28.2).
3. KPIs (decisão D5): na RPC suprimentos_requisicoes_para e telas consumidoras,
   separar pendente_aprovacao/aprovada/rejeitada num bloco "No gate" fora dos totais
   de fluxo ERP. (Recriar a RPC a partir do pg_get_functiondef do banco — regra 5.)
```

---

## Pendências registradas (não bloqueiam o plano)

1. **Ryan — `funcionario_alvo_codigo`:** banco tem `0000063`, roster documentado dizia
   `0000153`. Conferir no Alvo qual é o real e corrigir o lado errado.
2. **RLS ampla de `compras_requisicoes`/`compras_pedidos`** (`ALL using(true)`) — dívida
   Alta, blast radius grande, **missão própria** após este plano (o trigger + auditoria
   append-only seguram a superfície de aprovação até lá).
3. **Edge notify-aprovador-budget** — endurecer autorização (P2, fora deste plano).
4. **Moeda (MOEDA-PEDIDOS)** — missão própria já especificada; o D4 não a invade.
5. **Aposentadoria dos jsonb** (`classe_rateio`, `itens`, `parcelas`) — após S1/S2
   estáveis e telas migradas.
6. **Cobertura de líderes** (66 CCs sem responsável) — trabalho organizacional do Pedro,
   paralelo e independente do técnico.

---

*Fim do plano v1.0. Ordem: SQL-A1 → E0 → A2 → A3 → A5 → B1 → B2 → B3 → GATE B → C1 →
D1..D5 → E1..E6. Prompts imutáveis; ajustes viram AJUSTE-RS-x.md. Última revisão:
17/08/2026, com base nos CDX-1..4 e decisões D1–D9.*
