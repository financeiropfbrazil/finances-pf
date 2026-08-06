# DISCOVERY-APROVACAO-REQ.md — Fase 0 (PROMPT 0)

> Missão: **Aprovação de Requisições pelo Líder de Departamento** (guia `CLAUDE_APROVACAO_REQ.md` v2).
> Execução: **100% read-only** — MCP Supabase (`read_only=true`) + leitura/grep do repo. Nenhum DDL, nenhuma edição de código.
> Data: **06/08/2026** · Repo `C:\Users\PFBR-2601-3\finances-pf` @ `main` `7e6df52` · Supabase `hbtggrbauguukewiknew`

## 0. Provas de ambiente (pré-requisito do prompt)

| Prova | Comando | Resultado |
|---|---|---|
| Remote correto | `git remote -v` | `https://github.com/financeiropfbrazil/finances-pf.git` ✅ |
| Pull | `git pull origin main` | `Already up to date` — nenhum commit vindo do Lovable |
| Projeto Supabase | `select current_database(), count(*) compras_pedidos, count(*) compras_requisicoes` | `postgres` · **1803 pedidos** · **288 requisições** ✅ (fingerprint do CLAUDE.md era ~1.650 pedidos — crescimento normal do sync) |
| **MCP read-only** | `update profiles set updated_at = now() where false;` | ❌ `ERROR: 25006: cannot execute UPDATE in a read-only transaction` ✅ **prova confirmada** |

---

## 1. D1 — Esquema real de `compras_requisicoes`

```sql
select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='compras_requisicoes' order by ordinal_position;
```

26 colunas. As que importam para a missão:

| Coluna | Tipo | Nulo? | Observação |
|---|---|---|---|
| `id` | uuid | NO | PK |
| `requisitante_user_id` | uuid | **YES** | NULL ⇒ requisição **nativa do Alvo** (ver D8-pré) |
| `status` | **text** | NO | ✅ **confirmado text** — sem `ALTER TYPE`, sem enum |
| `codigo_centro_ctrl` | text | YES | chave do roteamento; 100% preenchido (D3) |
| `codigo_empresa_filial` | text | **NO** | NOT NULL — todo upsert precisa repetir |
| `numero_alvo` | text | YES | NULL enquanto não foi ao ERP |
| `enviado_em` / `tentativa_envio_em` | timestamptz | YES | trilha de envio atual |
| **`erro_ultimo_envio`** | **text** | YES | ⚠️ **não é `erro_envio jsonb`** |
| `updated_at` | timestamptz | NO | mantido por trigger `trg_compras_requisicoes_updated_at` |
| `numero_pedido_compra_alvo` | text | YES | elo com o pedido |

**Achados D1 (contradizem o plano v2):**

1. ⚠️ **`erro_envio jsonb` NÃO existe.** O que existe é `erro_ultimo_envio` **text**, já usado pelo fluxo legado. O §5.3/§5.4 do plano (RPC `registrar_envio_requisicao(p_req_id, p_numero_alvo, p_erro jsonb)`) precisa de decisão: criar a coluna nova **ou** gravar em `erro_ultimo_envio`. Ver §11 (pergunta 2).
2. ✅ **Nenhuma coluna de aprovação existe** (`aprovada_por_user_id`, `aprovada_em`, `aprovacao_automatica`, `rejeitada_*`, `motivo_rejeicao`) — o `alter table … add column if not exists` do §5.3 roda limpo.
3. ✅ `status` é `text` — a máquina de estados do §3 não exige DDL de tipo.

---

## 2. D2 — Domínio real de `status`

```sql
select status, count(*) from compras_requisicoes group by 1 order by 2 desc;
```

| status | qtd |
|---|---|
| `convertida_pedido` | 151 |
| `sincronizada` | 114 |
| `cancelada` | 19 |
| `rascunho` | 4 |

**Achados:**

- Existe um **quinto status no código que não aparece no banco: `pendente_envio`** (`requisicoesService.ts:313,525,810`). É **transitório**: gravado imediatamente antes da chamada ao Alvo; em sucesso vira `sincronizada`, em falha vira `rascunho`. Zero linhas hoje ⇒ nenhum envio ficou preso.
- ❌ **`'rascunho (erro)'` não é literal do banco.** É só o *label* do filtro na UI (`SuprimentosRequisicoes.tsx:362`). No banco, "rascunho com erro" = `status='rascunho'` **+** `erro_ultimo_envio not null`.
- ⚠️ **Consequência direta para a RPC 2.1 do plano:** ela exige `if v_req.status <> 'rascunho' then return 'STATUS_INVALIDO'`. **O wizard nunca cria uma req em `rascunho`** — ele cria já em `pendente_envio` e dispara o envio no mesmo clique (D11). Ou a RPC aceita o estado real, ou o wizard passa a persistir `rascunho` antes de submeter. Ver §10 (contradição 6).

---

## 3. D3 — Formato e cobertura de `codigo_centro_ctrl`

```sql
select codigo_centro_ctrl, count(*) from compras_requisicoes group by 1 order by 2 desc limit 30;
select count(*) total, count(codigo_centro_ctrl) com_cc from compras_requisicoes;
```

- ✅ **Formato bate com o plano**: `00010.00002.00003` (12 reqs), `00007.00001.00002` (36), `00010.00002.00002` (28)…
- ✅ **Cobertura 288/288 = 100%** — nenhuma req sem centro de custo. O `return 'SEM_CENTRO_CUSTO'` da RPC 2.1 é defesa, não caminho real.
- O formato é o `codigo_estendido` de **`rh_centros_custo`** (cadastro local do ERP), não o `codigo` curto:

| `codigo` | `codigo_estendido` | `nome` |
|---|---|---|
| 3591 | **`00010.00002.00003`** | **Controladoria/Financeiro** ← piloto |
| 393 | **`00001.00001.00004`** | **CONTROLADORIA/FINANCEIRA** ← homônimo, 1 req |
| 3575 | `00010.00002.00002` | Recursos Humanos |
| 3755 | `00010.00002.00008` | TI - Tecnologia da Informacao |

⚠️ **Existem DOIS centros de custo "Controladoria/Financeir*"** — o do piloto (`00010.00002.00003`, 12 reqs) e um homônimo antigo (`00001.00001.00004`, 1 req). O seed do §5.6 só cita o primeiro. Ver §11 (pergunta 1).

---

## 4. D4 — RLS completa da família de requisições

```sql
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
where tablename in ('compras_requisicoes','compras_requisicoes_itens',
                    'compras_requisicoes_itens_classe_rec_desp','compras_requisicoes_arquivos')
order by tablename, cmd;
```

| Tabela | Policy | cmd | qual / with_check |
|---|---|---|---|
| `compras_requisicoes` | `Allow all for authenticated on compras_requisicoes` | **ALL** | `true` / `true` |
| `compras_requisicoes_itens` | `Allow all for authenticated on compras_requisicoes_itens` | **ALL** | `true` / `true` |
| `compras_requisicoes_itens_classe_rec_desp` | `Allow all … _itens_classe` | **ALL** | `true` / `true` |
| `compras_requisicoes_arquivos` | `arquivos_select_auth` | SELECT | `exists(req)` |
| | `arquivos_insert_auth` | INSERT | `exists(req)` |
| | `arquivos_update_auth` | UPDATE | `exists(req)` |
| | `arquivos_delete_own` | DELETE | `uploaded_by = auth.uid() AND req.numero_alvo is null` |
| `compras_requisicoes_auditoria` (extra) | `Allow all …` | **ALL** | `true` / `true` |

**Achados — os mais importantes desta Fase 0:**

1. ❌ **A §5.5 do plano (policies de leitura para o líder) é DESNECESSÁRIA.** Qualquer usuário autenticado já lê **toda** requisição, item, classe de rateio, anexo e linha de auditoria. O detalhe da req na tela do líder **não vai quebrar por RLS**. Criar as policies do §5.5 seria inócuo (policies são OR — somar `true` com `true` não muda nada).
2. ⚠️ **Risco de segurança pré-existente (fora do escopo, mas material para esta missão):** a mesma policy `ALL … true` permite que **qualquer authenticated** faça `UPDATE`/`DELETE` em qualquer requisição via PostgREST. Ou seja, o gate de aprovação será aplicado por **UI + RPC**, mas **não** pelo banco: um usuário com token válido pode, em tese, mudar `status='aprovada'` sozinho. A regra 7 do FH47 ("frontend nunca `.update()` — CORS bloqueia PATCH") é uma proteção **acidental do navegador**, não um controle de segurança (curl ignora CORS). Ver §11 (pergunta 6).
3. O escopo `view_own` × `view_all` hoje é aplicado **só no frontend** (`SuprimentosRequisicoes.tsx:165-172`), não no banco.

---

## 5. D5 — `profiles`

```sql
select count(*) total, count(distinct user_id) distintos from profiles;   -- 52 / 52
```

- ✅ **`user_id` é único** (52 linhas, 52 distintos) — a chave canônica `profiles.user_id = auth.uid()` é segura para o join de `compras_lideres_cc`.
- Colunas: `id, user_id, full_name, avatar_url, created_at, updated_at, is_admin (bool, nullable), is_active, email, funcionario_alvo_codigo, must_change_password, alvo_usuario`.
- ✅ **Único `is_admin = true`: Pedro** — `user_id 0b52e262-2fd2-4e84-b414-456b8eb6df65`, `pedro.scrignoli@pfbrazil.com`, `funcionario_alvo_codigo 0000149`. Confirma a regra 13 de engajamento (testar tudo com usuário sem `is_admin`).
- ✅ O e-mail usado no seed do §5.6 (`pedro.scrignoli@pfbrazil.com`) **existe exatamente assim**.

---

## 6. D6 — Colisão de nomes de RPC + funções RBAC

```sql
select routine_name from information_schema.routines
where routine_schema='public' and (routine_name ilike '%requisi%' or routine_name ilike '%permission%');
```

`get_user_permissions`, `user_has_permission`, `set_compras_requisicoes_updated_at`, `buscar_requisicoes_sem_vinculo`, `vincular_pedido_requisicao`, `desvincular_pedido_requisicao`, `suprimentos_requisicoes_para`.

- ✅ **Zero colisão**: `submeter_requisicao`, `aprovar_requisicao`, `rejeitar_requisicao`, `registrar_envio_requisicao` **não existem**.
- ✅ **Assinaturas RBAC confirmadas** (ambas `SECURITY DEFINER` + `set search_path=public`):
  - `user_has_permission(p_user_id uuid, p_permission_code text) → boolean` — **ordem dos argumentos igual à usada no plano**; faz bypass `is_admin` internamente.
  - `get_user_permissions(p_user_id uuid) → table(codigo text)` — admin recebe o catálogo inteiro.
- Existe ainda `marcar_arquivo_req_enviado(p_guid, p_numero_alvo)` (não casou no filtro; usada em `requisicoesService.ts:654,869`) — precedente de RPC-para-contornar-PATCH.
- `suprimentos_requisicoes_para(...)` é relatório read-only com gate `compras.requisicoes.view_all`; **não filtra status** → passará a devolver pendentes/rejeitadas quando existirem (impacto documentado no D13).

---

## 7. D7 — Catálogo RBAC (para o seed da Fase 1)

```sql
select codigo, nome, modulo from hub_permissions where modulo='compras' order by codigo;
select codigo, nome, is_system from hub_roles order by codigo;
```

**Permissões de `compras` (15)** — e a quem estão mapeadas hoje:

| Permissão | Papéis |
|---|---|
| `compras.requisicoes.access` | admin, analista_compras, analista_fiscal, requisitante, visualizador_compras |
| `compras.requisicoes.create` | admin, analista_compras, analista_fiscal, requisitante |
| `compras.requisicoes.view_own` | admin, analista_compras, analista_fiscal, requisitante |
| `compras.requisicoes.view_all` | admin, analista_compras, analista_fiscal, visualizador_compras |
| `compras.requisicoes.delete_own` | admin, analista_compras, analista_fiscal, requisitante |
| `compras.requisicoes.reenviar_own` | admin, analista_compras, analista_fiscal, requisitante |
| (+ `compras.pedidos.*`, `compras.nfe.*`, `compras.cadastros.sync`) | |

- ✅ **`compras.requisicoes.aprovar` NÃO existe** → o insert do §5.1 roda limpo.
- ✅ **Papel `lider_departamento` NÃO existe.** Papéis atuais (12): `admin`(1 usuário), `analista_compras`(6), `requisitante`(42), `viewer_intercompany`(5), `controller_intercompany`(3), `responsavel_projeto`(3), `aprovador_projetos`(2), `operador_producao`(2), `financeiro`(1), `visualizador_compras`(1), `analista_fiscal`(0), `gestor_producao`(0).
- ✅ **Colunas dos inserts do plano conferem 1:1:**
  - `hub_permissions(id, codigo, nome, descricao, modulo NOT NULL, created_at)`
  - `hub_roles(id, codigo, nome, descricao, modulo NOT NULL, is_system NOT NULL default false, created_at, updated_at)` — `modulo` é **NOT NULL**, e o §5.1 já passa `'compras'` ✅
  - `hub_role_permissions(id, role_id, permission_id, created_at)`
  - `hub_user_roles(id, user_id, role_id, atribuido_por, atribuido_em default now(), revogado_por, revogado_em, motivo)` — o seed do §5.6 usa exatamente essas ✅

---

## 8. D8-pré — Como as reqs do Hub se distinguem das nativas

```sql
select (requisitante_user_id is not null) tem_requisitante, (numero_alvo is null) sem_numero, status, count(*)
from compras_requisicoes group by 1,2,3 order by 4 desc;
```

| tem_requisitante | sem_numero_alvo | status | qtd |
|---|---|---|---|
| true | false | convertida_pedido | 104 |
| **false** | false | sincronizada | 60 |
| true | false | sincronizada | 54 |
| **false** | false | convertida_pedido | 47 |
| true | false | cancelada | 10 |
| **false** | false | cancelada | 9 |
| true | **true** | rascunho | 4 |

- ✅ **Discriminador confirmado: `requisitante_user_id is not null` ⇒ nascida no Hub** (172 reqs). Nativas do Alvo (116) têm o campo NULL — coerente com a decisão 1 (gate só para reqs do Hub).
- ✅ **Só os 4 rascunhos estão sem `numero_alvo`.** Todos os demais estados já foram ao ERP. Isso valida a regra derivada do §3: `pendente_aprovacao`/`aprovada`/`rejeitada` sem `numero_alvo` ficam naturalmente fora de qualquer sync (ver D10).

---

## 9. D8 — Rota de envio Hub → Alvo (**resolvida na etapa 1, sem precisar dos arquivos do proxy**)

**Service:** `src/services/requisicoesService.ts` (1.223 linhas) — único ponto de envio de requisição do app.
Gateway: `ERP_PROXY_URL = "https://erp-proxy.onrender.com"` (`requisicoesService.ts:3`).

### 9.1 Rotas reais em uso

| Rota | Método | Quem chama | Auth |
|---|---|---|---|
| `/req-comp/insert` | POST (JSON) | `enviarRequisicao` (`:399`), `reenviarRequisicao` (`:843`) | `Bearer <JWT Supabase>` |
| `/req-comp/insert-multipart` | POST (multipart) | `enviarRequisicaoComArquivos` (`:630`), `reenviarRequisicao` (`:841`) | `Bearer <JWT Supabase>` |
| `/req-comp/{filial}/{numero}` | GET | `sincronizarStatusRequisicao` (`:1103-1109`), `pedidosService.ts:356`, cron `:739` | JWT (browser) / `X-System-Secret` (cron) |
| `/req-comp/update` | POST (JSON) | `pedidosService.ts:385` — baixa da req após virar pedido | `Bearer <JWT Supabase>` |
| `/req-comp/list?dataInicio&dataFim&apenasAbertas=false` | GET | cron Job 4 (`sync-compras-status-cron/index.ts:448`) | `X-System-Secret` |

Detalhes completos de payload/headers no **`ADENDO-ERP-PROXY-REQCOMP.md`** (entregável 2).

### 9.2 Como o sucesso é persistido hoje (crítico para a RPC 2.4 do plano)

Tudo é feito **pelo frontend**, com `.upsert(..., { onConflict: "id" })` — nunca `.update()` (regra 7 do FH47).

**Sucesso** (`requisicoesService.ts:403-418` e `:635-650`):
```
status: "sincronizada", numero_alvo: respData?.Numero || "", enviado_em: now()
+ repete requisitante_user_id, codigo_empresa_filial, codigo_funcionario,
  codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens
```
(o upsert precisa repetir os NOT NULL; `erro_ultimo_envio: null` só é limpo no **reenvio**, `:855`)

**Falha** (`:433-448`, `:676-691`, `:892-907`):
```
status: "rascunho", erro_ultimo_envio: <msg>, tentativa_envio_em: now()
```

**Auditoria** — 4 eventos gravados em `compras_requisicoes_auditoria`: `criada`, `envio_tentado` (com `payload_enviado`), `envio_sucesso` (com `resposta_alvo`), `envio_falha` (com `mensagem_erro`).

⚠️ **Dois pontos que quebram o desenho do §6.2 do plano:**
- `reenviarRequisicao` **só aceita `rascunho` ou `pendente_envio`** (`:754`) → o botão "Reenviar" da tela do líder (req `aprovada` + erro) **falha hoje** com "Só é possível reenviar requisições com status rascunho ou pendente de envio."
- Em qualquer falha de envio, o service **rebaixa o status para `rascunho`** — o que **apagaria a aprovação** de uma req aprovada. Precisa de tratamento explícito na Fase 2.

### 9.3 Achado lateral (fora de escopo, registrado)

`requisicoesService.ts:5` — `const USUARIO_LOGADO = "PEDRO.SCRIGNOLI";` **hardcoded**. Toda requisição chega ao Alvo como se fosse do Pedro (`CodigoUsuario` e `UsuarioLogado` do payload). A identidade real do requisitante só existe no Hub e no campo `Texto` (`montarTexto`, `:159-163`). Não afeta o gate, mas afeta a leitura da trilha no ERP.

---

## 10. D9 — Pontos que filtram status de requisição (auditoria das Fases 2/3)

Grep por `'sincronizada' | 'rascunho' | 'convertida_pedido' | 'cancelada' | 'pendente_envio'` em `src/` e `supabase/functions/`.

| Arquivo:linha | O que faz | Risco com os status novos |
|---|---|---|
| `src/lib/statusRequisicao.ts:15-85` | Badge/ícone/tooltip por status | ⚠️ `pendente_aprovacao`/`aprovada`/`rejeitada` caem no **fallback "Desconhecido"** (`:79`) — degrada, mas não quebra. Fase 3.4 |
| `src/pages/SuprimentosRequisicoes.tsx:35-41` | `STATUS_CONFIG` (2º mapa de labels, duplicado) | idem — sem entrada para os novos |
| `src/pages/SuprimentosRequisicoes.tsx:174-182` | Filtro de status da lista | **positivo** (`.eq`) quando escolhido; **sem filtro quando "todos"** → ver D13 |
| `src/pages/SuprimentosRequisicoes.tsx:362-366` | Dropdown de status (5 opções) | precisa dos 4 novos itens |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx:193` | Sincroniza status se `numero_alvo && status not in (rascunho, pendente_envio)` | ⚠️ **negação** — `aprovada`/`pendente_aprovacao` passariam, mas só se tivessem `numero_alvo` (não têm). Seguro por acidente; reescrever como lista positiva |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx:244` | `podeReenviar = rascunho \|\| pendente_envio` | precisa incluir `aprovada` + `erro_ultimo_envio` (§6.2) |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx:250` | `podeGerarPedido = … status === 'sincronizada' && !numero_pedido` | ✅ **positivo** — pendente/rejeitada nunca viram pedido |
| `src/pages/SuprimentosRequisicaoDetalhe.tsx:391,449,598` | Blocos condicionais de UI | ✅ positivos |
| `src/services/pedidosService.ts:1957-1959` | `clonarDeRequisicao` exige `status === 'sincronizada'` | ✅ **positivo — trava dura contra pendente virar pedido** |
| `src/services/requisicoesService.ts:754` | Guarda do reenvio | ⚠️ ver §9.2 |
| `src/services/requisicoesService.ts:1097` | `if (!req.numero_alvo) return {mudou:false}` | ✅ guarda `numero_alvo` já existe |
| `src/services/requisicoesService.ts:1120,1171-1180` | Mapper Alvo→Hub | ✅ só roda com `numero_alvo` |
| `supabase/functions/sync-compras-status-cron/index.ts:492` | `STATUS_TERMINAIS = ["convertida_pedido","cancelada"]` | adicionar `rejeitada` (defensivo — ver D10) |
| `supabase/functions/sync-compras-status-cron/index.ts:715-716` | Job 1: `.eq('status','sincronizada').not('numero_alvo','is',null)` | ✅ **duplamente positivo** |

**Conclusão D9:** nenhuma negação perigosa do tipo `NOT IN`/`neq` sobre status foi encontrada nos caminhos de escrita. As duas negações existentes (`Detalhe.tsx:193`, `requisicoesService.ts:754`) são protegidas pela ausência de `numero_alvo` nos estados novos, mas devem virar listas positivas na Fase 2/3.

---

## 11. D10 — Jobs de sync e o conjunto terminal

**Job 1 — `syncRequisicoes`** (`sync-compras-status-cron/index.ts:710-719`):
```ts
.eq("status", "sincronizada")
.not("numero_alvo", "is", null)
.gte("created_at", cutoff -180 dias)
```
✅ **Nenhum risco.** Filtro positivo por status **e** por `numero_alvo`. `pendente_aprovacao`, `aprovada` e `rejeitada` jamais entram como candidatas.

**Job 4 — descoberta** (`:445-670`): lê `/req-comp/list`, casa contra o Hub por **`numero_alvo IN (janela)`** (`:477-480`). Como os estados novos não têm `numero_alvo`, **nunca casam** → não são tocados. O `STATUS_TERMINAIS` (`:492`) só protege reqs que já foram ao ERP; incluir `rejeitada` (§6.3 do plano) é **defensivo e barato**, mas **não é estritamente necessário** — registro a nuance para o prompt da Fase 2 não gastar risco com o que já está seguro.

**`sincronizarStatusRequisicao`** (front, `requisicoesService.ts:1085-1099`): guarda `if (!req.numero_alvo) return { mudou:false }` ✅ já existe.

**Ponto de atenção real do Job 4:** ele faz `UPDATE` direto de `status` (`:546-555`) — se um dia uma req aprovada receber `numero_alvo` e o list vier defasado, o status volta para `sincronizada`. Isso é o comportamento desejado (a req já está no ERP), então não é problema.

**pg_cron:** o CLAUDE.md registra o job intercompany (jobid 14). O cron de compras roda 07h30/12h30/16h30 BRT (dias úteis) — **fora dessas janelas** para qualquer deploy que toque o sync.

---

## 12. D11 — Wizard "Nova Requisição"

**Arquivo:** `src/pages/SuprimentosRequisicaoNova.tsx` (~1.130 linhas), rota `/suprimentos/requisicoes/nova` (`App.tsx:256-262`).

- **O botão final envia direto ao Alvo** (`:380-383`):
  ```ts
  const result = arquivos.length > 0
    ? await enviarRequisicaoComArquivos({ ...inputBase, arquivos })
    : await enviarRequisicao(inputBase);
  ```
  Sucesso → toast com `numero_alvo` + `navigate("/suprimentos/requisicoes")`. Falha → toast "Falha ao enviar ao ERP" + *"A requisição foi salva como rascunho"* (`:396`).
- ❌ **NÃO existe "Salvar rascunho".** Grep por `rascunho|Salvar|salvar` no arquivo retorna só a mensagem de erro (`:396`) e o botão "Salvar" **do modal de item** (`:1363`). ✅ **Confirma a decisão 11 do plano: o rascunho persistente precisa ser criado.**
- Hoje o rascunho é **exclusivamente um subproduto de falha** — daí os 4 do D2.
- **Onde plugar (Fase 2/3):** o ponto único é `:380-383`. `submeter_requisicao` entra **antes** dessa chamada, e o envio legado vira função isolada acionada por `SEM_GATE`/`AUTO_APROVADA`.
- ⚠️ **Ordem de criação × roteamento:** hoje a linha da req só existe **dentro** de `enviarRequisicao` (que cria cabeçalho + itens + rateios + anexos e já dispara o envio, tudo numa função). Para chamar `submeter_requisicao(p_req_id)` é preciso **primeiro** persistir a req (com itens) e **só depois** decidir a rota — ou seja, a Fase 2 precisa **quebrar `enviarRequisicao` em duas partes**: `criarRequisicao(input) → id` e `enviarRequisicaoAlvo(id)`. Isso não estava explícito no §6.1 do plano.

---

## 13. D12 — Navegação e gate de telas por permissão

| Camada | Arquivo | Como funciona |
|---|---|---|
| Rota | `src/App.tsx:247-270` | `<PermissionRoute permKey="suprimentos_requisicoes">` nas 3 rotas de requisição |
| Tradução | `src/hooks/usePermissions.ts:14-21,75-94` | `hasAccess(key)`: (1) admin → `true`; (2) `MENU_TO_PERMISSION[key]` (menu_key migrado → código RBAC); (3) chave com ponto → checa RBAC direto; (4) fallback `user_permissions` legado |
| Hook fino | `src/hooks/useHasPermission.ts:14-22` | `useHasPermission(PERMISSIONS.X)` — bypass `is_admin`, senão `permissions.includes(x)` |
| Catálogo TS | `src/constants/permissions.ts:10-75` | espelho de `hub_permissions`; **`compras.requisicoes.aprovar` precisa ser adicionado aqui** (e `lider_departamento` em `ROLES`, `:85-95`) |
| Menu | `src/components/AppSidebar.tsx:113-119` | `suprimentosSubItems` com campo **`perm` opcional** por item (precedente: "Atualizar Cadastros" com `perm: "compras.cadastros.sync"`) |

✅ **Molde pronto para a fila do líder:** item novo em `suprimentosSubItems` com `perm: "compras.requisicoes.aprovar"` + rota `<PermissionRoute permKey="compras.requisicoes.aprovar">`. Como `isRbacCode()` detecta o ponto, o código RBAC funciona direto como `permKey`, sem tocar em `MENU_TO_PERMISSION`.

---

## 14. D13 — Fila das operadoras (⚠️ contradição relevante com o plano)

**Não existe uma "fila das operadoras" separada.** A tela `/suprimentos/requisicoes` (`SuprimentosRequisicoes.tsx`) é a mesma para requisitante e operadora; o que muda é o escopo:

```ts
// :83
const podeVerTodas = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_VIEW_ALL);
// :163-172
let query = supabase.from("compras_requisicoes").select("*").order("created_at", {ascending:false});
if (!podeVerTodas && user) { /* filtra por requisitante_user_id ou codigo_funcionario */ }
if (filtroStatus && filtroStatus !== "todos") { /* .eq("status", filtroStatus) */ }
```

❌ **O filtro padrão é `"todos"` ⇒ NENHUM filtro de status é aplicado.** Portanto:

> **A premissa do §3 do plano — *"Fila das operadoras continua filtrando `sincronizada` — pendentes invisíveis por construção"* — é FALSA.**
> Requisições `pendente_aprovacao` e `rejeitada` **aparecerão na listagem** de todos os 8 usuários com `view_all` (`admin` 1 + `analista_compras` 6 + `visualizador_compras` 1) já no primeiro dia do piloto — e para o próprio requisitante na visão `view_own`.

O que **está** protegido (travas positivas, essas sim por construção):
- `SuprimentosRequisicaoDetalhe.tsx:250` — botão "Gerar Pedido" só com `status === 'sincronizada'`;
- `pedidosService.ts:1957-1959` — `clonarDeRequisicao` **lança erro** se `status !== 'sincronizada'`.

Ou seja: **uma pendente não vira pedido**, mas **é vista**. A Fase 3 precisa de um filtro explícito (esconder os estados de aprovação de quem não é líder/admin, ou exibi-los com badge próprio) — decisão do Pedro (§16, pergunta 4).

Impacto colateral: `suprimentos_requisicoes_para` (RPC de relatório, gate `view_all`) também não filtra status → os KPIs passarão a contar pendentes/rejeitadas.

---

## 15. Contradições com o plano v2 (consolidado)

| # | Item do plano | Realidade medida | Ação sugerida |
|---|---|---|---|
| 1 | §5.3/§5.4 usam **`erro_envio jsonb`** | Coluna **não existe**; existe `erro_ultimo_envio` **text**, já em uso | Decidir: criar `erro_envio jsonb` **ou** reescrever a RPC 2.4 para `erro_ultimo_envio` (§16 q2) |
| 2 | §5.5 — policies RLS para o líder ler reqs dos CCs dele | RLS é `ALL … using true` — **líder já lê tudo**. Policies seriam inócuas | **Remover a §5.5 da Fase 1.** Registrar a RLS aberta como risco/dívida (§16 q6) |
| 3 | §3 — "operadoras não veem pendentes por construção" | **Falso**: lista sem filtro de status por padrão (D13) | Fase 3 precisa de filtro explícito na listagem (§16 q4) |
| 4 | RPC 2.1 exige `status = 'rascunho'` | Wizard nunca cria `rascunho`; cria `pendente_envio` e envia no mesmo clique | Ajustar a RPC ao estado real **ou** criar o rascunho antes de submeter (casa com a decisão 11) |
| 5 | §6.1 — "trocar o envio direto por `submeter_requisicao`" | `enviarRequisicao` cria a req **e** envia na mesma função — não há `p_req_id` antes do envio | Fase 2 precisa **quebrar** o service em `criarRequisicao()` + `enviarRequisicaoAlvo(id)` |
| 6 | §6.2 — botão Reenviar na tela do líder | `reenviarRequisicao` recusa qualquer status ≠ `rascunho`/`pendente_envio` (`:754`) e **rebaixa para `rascunho`** em falha — apagaria a aprovação | Ajuste explícito no service (Fase 2) |
| 7 | Decisão 12 — "trilha = colunas, **sem** tabela de eventos" | **`compras_requisicoes_auditoria` já existe e está viva** (719 linhas, 8 tipos de evento, última de hoje) | Colunas na req + **também** gravar `aprovada`/`rejeitada` na auditoria existente? (§16 q3) |
| 8 | §5.6 — seed do Financeiro = `00010.00002.00003` | Existe **homônimo** `00001.00001.00004` "CONTROLADORIA/FINANCEIRA" (1 req) | Confirmar lista final de CCs (§16 q1) |
| 9 | §4 — "adendo ao `relatorio-erp-proxy.md`" | **Esse arquivo não existe no repo** (há `SPEC-D001-erp-proxy.md`) | Adendo entregue em arquivo próprio: `ADENDO-ERP-PROXY-REQCOMP.md` |
| 10 | §11 — risco "D8 exige arquivos do proxy" | **Não foi necessário**: as 5 rotas se revelaram pelo frontend | Risco fechado |

**Não contradiz, mas confirma:** `status` é `text` (sem `ALTER TYPE`); `user_id` único; `user_has_permission` com a assinatura esperada; nenhuma colisão de nome de RPC; colunas de `hub_*` idênticas às usadas nos inserts; formato do CC igual ao do plano; cobertura de CC 100%; ausência de rascunho persistente.

---

## 16. Perguntas abertas (só o Pedro pode responder)

1. **CCs do piloto** — além de `00010.00002.00003` (Controladoria/Financeiro, 12 reqs), entra também o homônimo `00001.00001.00004` (CONTROLADORIA/FINANCEIRA, 1 req)? Algum outro CC do Financeiro?
2. **Erro de envio** — criar a coluna nova `erro_envio jsonb` (mantendo `erro_ultimo_envio` para o legado, com risco de dois lugares dizendo a mesma coisa) **ou** a RPC 2.4 grava em `erro_ultimo_envio` text (uma fonte só, perde o detalhe estruturado)? *Recomendação: reusar `erro_ultimo_envio`, que é o que a tela já lê.*
3. **Auditoria** — a decisão 12 disse "trilha nas colunas, sem tabela de eventos", mas `compras_requisicoes_auditoria` já existe e é usada em todo envio. As decisões de aprovação/rejeição devem gerar eventos lá (`aprovada`, `rejeitada`) além das colunas? *Recomendação: sim — custo zero, e a tela de histórico já existe.*
4. **Vazamento na listagem (D13)** — como tratar reqs `pendente_aprovacao`/`rejeitada` para quem tem `view_all` e **não** é líder do CC: (a) esconder por padrão, (b) mostrar com badge distinto, (c) mostrar só para admin? Isso muda o §7.4.
5. **Cobaia do piloto** — qual usuário `requisitante` sem `is_admin` e sem papel de líder será usado na Fase 5?
6. **RLS aberta (D4)** — a policy `ALL … using true` deixa qualquer authenticated escrever em qualquer requisição via API. Tratar nesta missão (fechar UPDATE/DELETE e canalizar tudo por RPC) ou registrar como dívida separada? *Não bloqueia o gate, mas o gate só será real no dia em que a RLS fechar.*

---

## 17. Gate de saída da Fase 0

| Requisito | Status |
|---|---|
| D1–D8-pré respondidos com query + resultado | ✅ |
| D8 (rota real de envio) | ✅ resolvido no frontend — proxy não foi necessário |
| D9–D13 respondidos com arquivo + linha | ✅ |
| `DISCOVERY-APROVACAO-REQ.md` na raiz | ✅ este arquivo |
| Adendo do proxy | ✅ `ADENDO-ERP-PROXY-REQCOMP.md` |
| Decisão residual de desenho fechada com o Pedro | ⏳ **pendente** — 6 perguntas do §16 |

**Nenhuma escrita foi feita no banco nem no código.** Próximo passo: respostas do §16 → revisão do §5 do guia (que precisa de ajuste nos pontos 1, 2, 4, 5 e 6 da tabela §15) → PROMPT 1.
