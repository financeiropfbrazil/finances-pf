# DISCOVERY-FASE6.md — Mapa de Líderes por Centro de Custo

> **PROMPT 6.0 — Fase 6.0 da `FASE6-MAPA-LIDERES-CC.md` (§4).** 100% leitura: nenhum SQL de
> escrita, nenhum arquivo de código alterado, nenhuma RPC criada.
> Executado em **10/08/2026** via MCP do Supabase (`read_only`) + leitura do repo.
>
> **Projeto confirmado por fingerprint antes da 1ª query:** `db=postgres`,
> `compras_pedidos = 1820` (mesmo valor medido no PROMPT 1.3-EXEC hoje), `compras_requisicoes = 309`,
> `compras_lideres_cc = 1`. Projeto `hbtggrbauguukewiknew`. ✅

---

## 0. Resposta ao ponto crítico do Discovery

A espec (§4, "Ponto crítico") pergunta se existe tabela espelho de CCs no Hub, porque a resposta
muda a arquitetura da tela.

> ### ✅ **EXISTE tabela espelho: `public.cost_centers` (182 linhas).**
> Não é preciso consultar o Alvo em tempo real nem derivar os CCs das requisições. A tela lê o
> espelho, exatamente como o wizard de requisição já faz.

**Porém:** a query do F-D1 escrita na espec **não encontra essa tabela** — ela filtra por
`%centro%`, `%cc%`, `%custo%`, `%ctrl%`, e a tabela tem nome **em inglês**. Rodada verbatim, a query
devolve `rh_centros_custo`, que é **a tabela errada** (detalhe em F-D1). Um Discovery que parasse na
query da espec teria concluído "existe espelho" apontando para a tabela do módulo de RH — que tem
outra chave, outra granularidade e cobre só 36 dos 43 CCs em uso.

---

## 1. F-D1 — De onde vem a lista de centros de custo?

### 1.1 A query da espec, rodada verbatim

```sql
select table_name from information_schema.tables
where table_schema='public' and (table_name ilike '%centro%' or table_name ilike '%cc%'
      or table_name ilike '%custo%' or table_name ilike '%ctrl%');
```
**Resultado:** `balancete_accounts`, `bank_accounts`, `compras_lideres_cc`,
`imob_auditorias_missoes_setores`, `imob_setores`, **`rh_centros_custo`**, `rh_custo_recorrente`,
`rh_departamentos`, `rh_departments`. — **`cost_centers` não aparece.**

A tabela certa foi achada por outro caminho: grep no repo pelo seletor de CC do wizard
(`src/pages/SuprimentosRequisicaoNova.tsx:269-277`), que lê `.from("cost_centers")`.

### 1.2 As duas candidatas, medidas lado a lado

| | `cost_centers` ✅ | `rh_centros_custo` ❌ |
|---|---|---|
| Linhas | **182** | 125 |
| Chave do código do Alvo | **`erp_code` (text, NOT NULL, 182 distintos)** | `codigo` (numérico curto: `217`, `271`…) + `codigo_estendido` |
| Formato bate com `compras_requisicoes.codigo_centro_ctrl` | **43 de 43 (100%)** | 36 de 43 via `codigo_estendido`; **0 de 43** via `codigo` |
| Usada por telas de Suprimentos | **Sim — 7 telas** (F-D5) | **Nenhuma** |
| Marca de ativo | `is_active` (+ `valid_from`/`valid_until`) | `ativo` (125/125 `true` — nunca desativa) |
| Hierarquia | `parent_code`, `group_type` (T/F) | `centro_custo_pai` (uuid), `classe` |
| Escopo | 1 empresa | **2 `company_id`** (31 CCs no bloco `00001.*`, 94 nos blocos `00007–00010`) |

**Veredito:** `cost_centers` é o espelho do Alvo e a única fonte coerente com `compras_requisicoes`.
`rh_centros_custo` é uma segunda cópia, do módulo de RH, desatualizada (não conhece 7 dos CCs em uso)
e sem noção de inativo. **É um caso do padrão LIVRO × ESPELHO do CLAUDE.md**: duas tabelas do mesmo
conceito, e ler pela errada dá erro silencioso e plausível — o mapa de líderes ficaria com 7 CCs a
menos e ninguém notaria.

### 1.3 Estrutura de `cost_centers` (medida)

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `erp_code` | text **NOT NULL** | código do Alvo; é a chave de junção com `codigo_centro_ctrl` |
| `erp_short_code` | text | reduzido do Alvo; 81/81 preenchidos e distintos nos ativos-folha |
| `name` | text NOT NULL | descrição |
| `parent_code`, `group_type`, `cost_type`, `department_type` | text | `group_type`: `T` = totalizador, `F` = folha |
| `is_active` | bool default true | **derivado**: `!DataValidadeFinal \|\| DataValidadeFinal > hoje` (F-D7) |
| `valid_from`, `valid_until` | date | vindos do Alvo |
| `created_at`, `updated_at` | timestamptz | |

⚠️ **Sem UNIQUE em `erp_code` no catálogo consultado** — o `onConflict: "erp_code"` do upsert da tela
de CCs depende de um índice único; `erp_code` tem 182 valores distintos em 182 linhas hoje, então na
prática não há duplicata, mas isso não foi confirmado como constraint.

### 1.4 🔴 RLS de `cost_centers` — escrita aberta a todo autenticado

```sql
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname='public' and tablename='cost_centers';
```
| policyname | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `Allow all for authenticated on cost_centers` | **ALL** | `{authenticated}` | `true` | `true` |

Qualquer usuário logado pode INSERT / UPDATE / **DELETE** em `cost_centers` pela API. A tela
`settings/CostCenters.tsx:305` inclusive expõe um `.delete()` físico. Como `compras_lideres_cc`
**não tem FK** para `cost_centers`, apagar um CC deixa o mapeamento de liderança órfão, apontando
para um código que não existe mais — e a tela da Fase 6 mostraria cobertura errada.
Fora do escopo desta fase (§8 exclui edição de CCs), mas é o alicerce da tela nova. → Pergunta P4.

---

## 2. F-D2 — Formato e cardinalidade reais dos CCs nas requisições

```sql
select codigo_centro_ctrl, count(*) from compras_requisicoes group by 1 order by 2 desc;
```

- **309 requisições**, **43 CCs distintos**, **0 requisições sem CC** (`codigo_centro_ctrl` nunca nulo).
- Top 5: `00007.00001.00002` (40), `00010.00002.00002` (31), `00008.00001.00001` (19),
  `00001.00004.00002` (17), `00010.00002.00008` (17).
- Cauda longa: 12 CCs com 1–2 requisições.
- **`centro_ctrl_nome` é praticamente inútil: preenchido em 4 de 309 linhas.** A descrição do CC na
  tela **tem** de vir do join com `cost_centers.name`.

### 2.1 ⚠️ O formato do código **não** é fixo

O padrão dominante é `NNNNN.NNNNN.NNNNN` (3 níveis × 5 dígitos), mas entre os CCs **ativos** há
exceções reais:

| `erp_code` | `name` | Por que quebra o padrão |
|---|---|---|
| `00010.00002.00007.00001` | COMPRAS | **4 níveis** |
| `00010.00002.00007.00002` | ALMOXARIFADO/EXPEDICAO | 4 níveis |
| `00010.00002.00007.00003` | LOGISTICA | 4 níveis |
| `00008.00002.000012` | BC-02 NC BALLOON CATHETER | **6 dígitos** no último nível |

**Consequência para a Fase 6.1:** a validação de `p_cc` em `atribuir_lider_cc` (§5.2, passo 3)
**não pode ser regex de formato** — tem de ser existência em `cost_centers`. Uma regex
`^\d{5}(\.\d{5}){2}$` rejeitaria 4 centros de custo ativos e legítimos.

### 2.2 Status das requisições hoje

| status | qtd |
|---|---|
| `convertida_pedido` | 160 |
| `sincronizada` | 122 |
| `cancelada` | 21 |
| `rascunho` | 4 |
| `rejeitada` | 2 |

🔴 **Zero requisições em `pendente_aprovacao`.** Consequência direta para a espec: o número que
`revogar_lider_cc` devolve (§5.3, passo 4) e o aviso da UI (**F5**) serão **0 em todo teste** e a
coluna "nº de pendentes" do mapa (§5.4, §6) nascerá zerada em todas as linhas. Não é defeito — é o
estado real do módulo, que acabou de entrar em produção. → Pergunta P5.

---

## 3. F-D3 — Estado atual do mapeamento e do papel

```sql
select l.*, p.email, p.is_admin, c.name from compras_lideres_cc l
left join profiles p on p.user_id=l.lider_user_id
left join cost_centers c on c.erp_code=l.codigo_centro_ctrl order by l.created_at;
```
| lider | CC | nome do CC | ativo | created_at |
|---|---|---|---|---|
| `pedro.scrignoli@pfbrazil.com` (`is_admin=true`) | `00010.00002.00003` | CONTROLADORIA/FINANCEIRO | `true` | 07/08/2026 19:49:19 |

**1 linha. É o seed do piloto.** Papel `lider_departamento`: **1 atribuição ativa**, também o Pedro
(`atribuido_em` 07/08/2026 19:49:12, `revogado_em` null) — mapeamento e papel estão coerentes.

### 3.1 Estrutura de `compras_lideres_cc` (confirma o §5.1 da espec)

| Coluna | Tipo |
|---|---|
| `id` | uuid |
| `lider_user_id` | uuid |
| `codigo_centro_ctrl` | text |
| `ativo` | boolean |
| `created_at` | timestamptz |

**Constraints:** PK em `id` + **`UNIQUE (lider_user_id, codigo_centro_ctrl)`**.
✅ O upsert do §5.2 (passo 4) tem a chave de conflito de que precisa.
❌ **Sem nenhuma coluna de auditoria** — o `alter table … add column if not exists` do §5.1 é
necessário e não é no-op.
❌ **Sem FK** para `profiles`/`auth.users` nem para `cost_centers` — a validação de `p_user_id`
(§5.2, passo 2) é obrigatória no corpo da RPC, o banco não vai barrar.

**RLS:** ligada, **uma única policy**, `lideres_cc_select` — `SELECT`, role `authenticated`,
`using true`. Zero policies de INSERT/UPDATE/DELETE. ✅ Confirma o §5.5: toda escrita terá de passar
pelas RPCs `SECURITY DEFINER`.

---

## 4. F-D4 — Quem pode administrar hoje

| Rota | Quem |
|---|---|
| Permissão `admin.users.manage` via papel ativo | **`pedro.scrignoli@pfbrazil.com`** (1) |
| `profiles.is_admin = true` | **`pedro.scrignoli@pfbrazil.com`** (1) |

**53 profiles, todos ativos, 1 admin.** `admin.users.manage` é a **única** permissão do catálogo com
prefixo `admin.` — não existe `admin.compras.*` nem nada próximo de `compras.lideres.manage`.

Sobre o **F1** ("validar na Fase 0 se convém `compras.lideres.manage` própria"): **não convém criar
agora.** Os dois conjuntos são hoje o mesmo usuário; uma permissão nova só multiplicaria superfície
sem separar ninguém de nada. A separação vira útil quando existir um segundo administrador — e aí
entra como ajuste. **Porém** a escolha entre `admin.users.manage` e `is_admin` **não** é indiferente:
ver §5.2 abaixo. → Pergunta P2.

---

## 5. F-D5 / F-D6 — Fonte do seletor de CC e padrão das telas administrativas

### 5.1 F-D5 — o wizard lê `cost_centers` com DOIS filtros

`src/pages/SuprimentosRequisicaoNova.tsx:269-277`:
```ts
const { data: costCenters = [] } = useQuery({
  queryKey: ["cost_centers_requisicao_wizard"],
  queryFn: async () => await (supabase as any)
    .from("cost_centers")
    .select("erp_code, name, department_type")
    .eq("is_active", true)
    .eq("group_type", "F")          // ← F = folha (analítico)
    .order("name", { ascending: true }),
```

**`is_active = true` AND `group_type = 'F'` → 81 CCs.** Esse é o universo que o usuário consegue
escolher ao criar uma requisição, e portanto **o denominador natural da cobertura** da Fase 6.

O par de filtros é o padrão do Hub — repetido **verbatim** em 7 lugares:

| Arquivo:linha | Filtro |
|---|---|
| `src/pages/SuprimentosRequisicaoNova.tsx:273-276` | `is_active` + `group_type='F'` |
| `src/pages/SuprimentosPedidoNovo.tsx:332-335` | `is_active` + `group_type='F'` |
| `src/services/reqMatService.ts:885-888` | `is_active` + `group_type='F'` |
| `src/components/compras/LancarNfeItensTable.tsx:646-649` | `is_active` + `group_type='F'` |
| `src/components/compras/ConfirmarLancamentoModal.tsx:302` | `is_active` + `group_type='F'` |
| `src/pages/CreditCardInvoice.tsx:96-99` | `is_active` + `group_type='F'` |
| `src/pages/NfEntrada.tsx:216-219` | `is_active` + `group_type='F'` |
| `src/pages/ProjetoRequisicoes.tsx:236` | ⚠️ só `is_active` (sem `group_type`) — divergente |
| `src/services/cartaoImportService.ts:406-409` | ⚠️ só `is_active` — divergente |

**Recomendação (§6 da espec, "reusar essa fonte"): `is_active=true AND group_type='F'`**, os mesmos
81. Os dois divergentes são de outros módulos e não devem servir de molde.

### 5.2 O que `group_type` significa (medido)

| `group_type` | ativos | níveis do código | O que é |
|---|---|---|---|
| `T` | 19 | 4 de nível 1, 14 de nível 2, 1 de nível 3 | **Totalizador** — nós sintéticos (`00007` NEGOCIOS, `00010.00002` OPERACOES). Não recebem lançamento |
| `F` | 81 | 77 de nível 3 + 4 exceções (§2.1) | **Folha** — é onde a requisição cai |

Atribuir líder a um `T` não teria efeito: **nenhuma requisição usa CC totalizador** — os 43 CCs em
uso são todos `F`. Incluir os 19 `T` no mapa só inflaria o denominador com linhas que nunca terão
pendência.

### 5.3 F-D6 — molde das telas administrativas: `src/pages/settings/Users.tsx`

| Aspecto | Como é hoje |
|---|---|
| Rota | `src/App.tsx:557` — `<Route path="/settings/users" element={<UsersSettings />} />` — **sem `PermissionRoute`** (ao contrário de `/settings/cost-centers:544`, que tem `permKey="settings"`) |
| Menu | `AppSidebar.tsx:182` — `adminOnly: true`, escondido por `!isAdmin` (`:349`) |
| Gate na página | `Users.tsx:132` `const isCurrentUserAdmin = profile?.is_admin === true;` → `:164-174` early return com card **"Acesso restrito a administradores."** |
| Leitura | RPC `hub_list_users_with_roles()` (`:137`) |
| Escrita de papel | RPCs `hub_assign_role` (`:346`) / `hub_revoke_role` (`:373`) — **nunca `.update()` direto** |
| Feedback | `toast` com `variant:"destructive"` no erro, mensagem do `err.message` |

### 5.4 🔴 As RPCs `hub_*` gateiam por `is_admin`, **não** por `admin.users.manage`

```sql
-- hub_caller_is_admin()
SELECT COALESCE(is_admin, FALSE) FROM public.profiles WHERE user_id = auth.uid();
```
`hub_list_users_with_roles`, `hub_assign_role` e `hub_revoke_role` **todas** começam com
`IF NOT public.hub_caller_is_admin() THEN RAISE EXCEPTION … ERRCODE '42501'`.

Já `user_has_permission(uid,'admin.users.manage')` retorna true para `is_admin` **ou** para quem
tenha a permissão por papel. **Os dois gates são hoje o mesmo usuário (Pedro), então a diferença é
invisível** — a armadilha exata registrada no CLAUDE.md.

**Consequência concreta para a Fase 6.2:** a espec (§6) manda o seletor de usuário usar "a mesma
fonte das telas de administração existentes" — isto é, `hub_list_users_with_roles`. Se a tela for
gateada por `admin.users.manage` (F1) e um dia alguém receber essa permissão **sem** `is_admin`,
essa pessoa **vê a tela e o seletor de usuários explode com exceção 42501**. Tela meio-viva.
→ Pergunta P2.

### 5.5 Duas diferenças de contrato entre as RPCs `hub_*` e as RPCs previstas na Fase 6.1

1. **`hub_assign_role`/`hub_revoke_role` sinalizam erro por `RAISE EXCEPTION`**; as RPCs da missão
   (`submeter_requisicao`, `aprovar_requisicao`, `rejeitar_requisicao`) devolvem **código de retorno
   em texto** (`SEM_PERMISSAO`, `FORA_DO_SEU_CC`…), traduzido por `traduzirDecisao`. A espec da 6.1
   (§5.2, passo 6: "retorna `OK` / código de erro") segue o **segundo** padrão — o da missão. Vale
   manter, mas fica registrado que a tela nova conviverá com os dois estilos se reusar o seletor.
2. **`hub_assign_role` faz atribuição composta** (`analista_compras` → também concede `requisitante`)
   e **`hub_revoke_role` protege o último admin**. A RPC `atribuir_lider_cc` do §5.2 vai gravar em
   `hub_user_roles` **por fora** dessas RPCs, então não herda nenhuma dessas proteções — nem precisa
   (`lider_departamento` não é composto nem é admin), mas o `motivo` e o `atribuido_por` devem ser
   preenchidos no mesmo espírito.

### 5.6 `hub_user_roles` — o molde de auditoria que o §5.1 quer espelhar

| Coluna | Tipo | Nulo |
|---|---|---|
| `id`, `user_id`, `role_id` | uuid | NO |
| `atribuido_por` | uuid | YES |
| `atribuido_em` | timestamptz | **NO** |
| `revogado_por` | uuid | YES |
| `revogado_em` | timestamptz | YES |
| `motivo` | text | YES |

✅ O `alter table` do §5.1 espelha esse molde exatamente. Único ajuste a considerar: em
`hub_user_roles` o `atribuido_em` é **NOT NULL**; o `add column` do §5.1 nasce nulável (as linhas
existentes não têm valor). Com 1 linha na tabela, dá para preencher e endurecer depois — decisão do
Pedro, não bloqueia.

### 5.7 Nenhuma colisão de nomes

```sql
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (proname in ('atribuir_lider_cc','revogar_lider_cc','listar_mapa_lideres')
   or proname ilike '%lider%');
```
**Zero linhas.** Os 3 nomes da Fase 6.1 estão livres.

---

## 6. F-D7 — Como os CCs são sincronizados do Alvo

### 6.1 Não há cron. O sync é **manual, sob demanda, por um botão**

`select jobid, jobname, schedule from cron.job` → 12 jobs ativos (compras-status, despesas, docfin,
intercompany, lote, produtos, laudos, reqmat, tomticket, empregare, 2 de notificação de pedido).
**Nenhum de centros de custo.** Grep em `supabase/functions/` por `cost_centers`: **nenhum arquivo**.

O único caminho é `src/pages/settings/CostCenters.tsx:133-239` — botão "Sincronizar":

```ts
const auth = await authenticateAlvo();
resp = await fetch(`${ERP_BASE_URL}/CentroCtrl/RetornaListaCentroCtrl`, {   // :148-160
  method: "POST", headers: { "riosoft-token": currentToken },
  body: JSON.stringify({ filtroListaCentroCtrl: { codigoEmpresaFilial: "1.01" } }),
});
…
await supabase.from("cost_centers").upsert(payload, { onConflict: "erp_code" });   // :217-219
```

### 6.2 🔴 Esse sync chama o Alvo **direto do navegador**, contra a regra do CLAUDE.md

`const ERP_BASE_URL = "https://pef.it4you.inf.br/api"` (`CostCenters.tsx:72`) — chamada direta ao
ERP, **sem passar pelo `erp-proxy`**. O CLAUDE.md diz: *"Chamadas ao Alvo a partir do frontend:
**sempre via gateway** (direto do navegador dá CORS)"*. Este código é anterior a essa regra e a
contradiz. Não testei se funciona (seria chamada externa a sistema de produção, fora do escopo
read-only). Só existem duas possibilidades, e as duas importam: ou o endpoint tem CORS liberado e é
uma exceção não documentada, ou **o botão está quebrado** — o que explicaria o §6.3.

### 6.3 O espelho está **congelado desde 30/07/2026**

```sql
select max(updated_at), min(updated_at), count(*) from cost_centers;
```
| ultimo_sync | mais_antigo | linhas |
|---|---|---|
| `2026-07-30 19:54:09.977+00` | `2026-07-30 19:54:09.977+00` | 182 |

**Todos os 182 registros têm `updated_at` idêntico ao milissegundo** — o sync rodou **uma única vez**,
há 11 dias, e nunca mais. Não há "última sincronização" na tela para o usuário perceber isso.
O mapa de líderes vai retratar o Alvo **de 30/07/2026**, não o de hoje. → Pergunta P3.

### 6.4 CCs inativos: sim, existem — e são **uma renumeração inteira do plano de contas**

`is_active` é derivado no mapper (`CostCenters.tsx:211-213`):
`is_active = !item.DataValidadeFinal || new Date(item.DataValidadeFinal) > new Date()`
— ou seja, **"inativo" = expirado no Alvo**, e a expressão foi avaliada no instante do sync (30/07).

| bloco do `erp_code` | ativos | inativos | `valid_until` |
|---|---|---|---|
| `00001.*` | **0** | **82** | 28/02/2025 … 18/05/2026 |
| `00007.*` | 40 | 0 | null |
| `00008.*` | 29 | 0 | null |
| `00009.*` | 3 | 0 | null |
| `00010.*` | 28 | 0 | null |

**75 dos 82 inativos foram encerrados no mesmo dia: 17/05/2026.** O bloco `00001.*` inteiro morreu e
foi substituído pelos blocos `00007–00010`. É uma **renumeração do plano de centros de custo no
Alvo**, não CCs que "caíram em desuso" um a um. A prova mais limpa: "CONTROLADORIA/FINANCEIRO" existe
duas vezes — `00001.00001.00004` (inativo, expira 17/05/2026) e `00010.00002.00003` (**ativo**, sem
validade) — e é justamente o CC do piloto.

### 6.5 O impacto disso no denominador da cobertura

Dos 43 CCs com requisições: **29 ativos** e **14 inativos** — todos os 14 do bloco `00001.*`,
todos com `valid_until = 2026-05-17`, todos com histórico **anterior** à renumeração:

| CC | nome | reqs | última req |
|---|---|---|---|
| `00001.00004.00002` | DEPARTAMENTO P&D | 17 | 11/06/2026 |
| `00001.00003.00001` | VENDAS/ MARKETING CORPORATIVO | 13 | 25/05/2026 |
| `00001.00007.00001` | ENGENHARIA DE MANUFATURA | 10 | 25/05/2026 |
| `00001.00002.00001` | GARANTIA DA QUALIDADE | 6 | 25/05/2026 |
| `00001.00001.00003` | RECURSOS HUMANOS | 6 | 25/05/2026 |
| …mais 9 | | 1–5 cada | |

🔴 **Se o mapa listar "todos os CCs que aparecem em requisições" (o caminho que a espec deixa em
aberto no §5.4), esses 14 entram como "sem líder" e a cobertura fica permanentemente falsa** — são
códigos mortos que nunca mais receberão requisição. O filtro "sem líder" (§6), que é a leitura de
controle interno da tela, apontaria 14 lacunas inexistentes.

**Denominador recomendado: os 81 CCs `is_active AND group_type='F'`** — o mesmo universo que o
wizard oferece. Cobertura hoje: **1 de 81 = 1,2%**. → Pergunta P1.

---

## 7. O que contradiz a especificação

1. **A query do F-D1 não acha a tabela certa** (§0). Ela devolve `rh_centros_custo`; a fonte real é
   `cost_centers`, invisível ao filtro por estar em inglês. Seguir a espec ao pé da letra levaria à
   tabela errada — com 7 CCs a menos e sem noção de inativo.
2. **§5.2 passo 3 — "Valida `p_cc` não vazio → senão `CC_INVALIDO`" é fraco demais.** Aceitaria
   qualquer string. Como não há FK (§3.1), a validação tem de ser **existência em `cost_centers`**;
   e **não pode ser regex de formato**, porque 4 CCs ativos fogem do padrão de 3×5 dígitos (§2.1).
3. **§5.4 não define a fonte do "CC conhecido"** — remete a F-D1/F-D5, que agora divergem: F-D1
   sugere derivar das requisições, F-D5 aponta para os 81 do wizard. As duas dão respostas diferentes
   (43 vs 81, com 14 CCs mortos no meio). Precisa de decisão. → P1.
4. **F1 assume que `admin.users.manage` é o gate natural, mas todo o resto da administração do Hub
   usa `is_admin`** (§5.4). Escolher a permissão sem mexer nas RPCs `hub_*` cria uma tela que pode
   ficar meio-viva. → P2.
5. **§5.3 passo 4 e F5 (aviso de pendentes) não são testáveis hoje**: zero requisições em
   `pendente_aprovacao` (§2.2). O número será 0 em todos os cenários de validação (§7 da espec,
   passo 3). → P5.
6. **§6 "Tabela principal: … descrição"** — a descrição **não** pode vir de
   `compras_requisicoes.centro_ctrl_nome` (preenchido em 4 de 309 linhas); só do join com
   `cost_centers.name`.
7. **§5.1 (`atribuido_em timestamptz default now()`)** diverge levemente do molde que diz espelhar:
   em `hub_user_roles` essa coluna é NOT NULL (§5.6). Diferença menor e contornável.
8. **§8 "o Hub só espelha" os centros de custo** — verdade quanto à intenção, mas hoje o espelho
   **é gravável por qualquer autenticado** (§1.4) e a tela de CCs permite criar/editar/apagar à mão.
   O mapa de alçadas vai repousar sobre uma tabela sem trava.

---

## 8. Perguntas que só o Pedro pode responder

**P1 — Qual é o universo de CCs do mapa (o denominador da cobertura)?**
&nbsp;&nbsp;(a) **os 81 `is_active AND group_type='F'`** — mesma fonte do wizard, cobertura 1/81 = 1,2% *(recomendo)*;
&nbsp;&nbsp;(b) os 81 + os 14 inativos que têm histórico, marcados como "encerrado" e fora da conta de cobertura;
&nbsp;&nbsp;(c) todos os 100 ativos, incluindo os 19 totalizadores.
A escolha muda o filtro "sem líder", que é a leitura de controle interno da tela.

**P2 — Gate da tela e das RPCs: `admin.users.manage` (F1) ou `is_admin` (o padrão de fato do Hub)?**
Se ficar `admin.users.manage`, o seletor de usuários precisa de fonte própria — a RPC existente
`hub_list_users_with_roles` exige `is_admin` e lança exceção para todo o resto (§5.4). Alternativas:
(a) usar `is_admin`, coerente com Users.tsx; (b) manter a permissão e criar uma RPC de listagem
mínima (id, nome, e-mail) gateada por `admin.users.manage`; (c) manter a permissão e aceitar que hoje
os dois conjuntos são a mesma pessoa, deixando a divergência registrada como dívida.

**P3 — O espelho de CCs está congelado desde 30/07/2026 (§6.3) e o botão de sync chama o Alvo por
fora do gateway (§6.2). Entra nesta fase?** Sincronizar não é "editar centro de custo", então não
cai no §8 automaticamente. Opções: (a) fora de escopo, só registrar como dívida; (b) a tela do mapa
mostra "espelho atualizado em <data>" para o risco ficar visível; (c) missão própria para levar o
sync ao gateway.

**P4 — `cost_centers` aceita escrita e DELETE de qualquer autenticado (§1.4), e não há FK entre ela e
`compras_lideres_cc`.** Fechar a RLS agora (fora do escopo da Fase 6) ou registrar como dívida ao
lado da DÍVIDA-RLS-COMPRAS-REQ?

**P5 — Validação (§7 da espec) com zero requisições pendentes.** Para exercitar o passo 3
("requisições pendentes daquele CC continuam intactas") é preciso **criar uma requisição de teste** e
submetê-la num CC com líder de teste. Autoriza criar essa requisição em produção — e em qual CC?

---

## 9. Resumo executivo

| Pergunta | Resposta | Evidência |
|---|---|---|
| **F-D1** | ✅ Existe espelho: **`cost_centers`** (182 linhas, chave `erp_code`, casa 43/43). **A query da espec não a encontra** e aponta a tabela errada (`rh_centros_custo`) | §1 |
| **F-D2** | 43 CCs distintos em 309 requisições; formato **não é fixo** (há 4 níveis e 6 dígitos); `centro_ctrl_nome` nulo em 305/309; **0 pendentes** | §2 |
| **F-D3** | 1 mapeamento (Pedro × `00010.00002.00003`), 1 papel ativo, coerentes. Tabela **sem** colunas de auditoria, **com** UNIQUE (bom p/ upsert), **sem** FK, RLS só de SELECT | §3 |
| **F-D4** | Só o Pedro — nas duas rotas (`admin.users.manage` e `is_admin`). 53 profiles, 1 admin | §4 |
| **F-D5** | Wizard lê `cost_centers` com `is_active=true AND group_type='F'` → **81 CCs**; padrão repetido em 7 telas | §5.1 |
| **F-D6** | Molde = `settings/Users.tsx`: gate `profile.is_admin` + card "Acesso restrito", escrita só por RPC. Mas as RPCs `hub_*` usam **`is_admin`**, não a permissão | §5.3–5.5 |
| **F-D7** | **Sem cron.** Sync manual por botão, **direto do Alvo sem gateway**, rodado **1 vez em 30/07/2026**. 82 CCs inativos = **renumeração do bloco `00001.*` em 17/05/2026** | §6 |

**Arquitetura liberada:** a tela lê o espelho `cost_centers` (não precisa de proxy nem de derivação a
partir das requisições). As 3 RPCs do §5 são viáveis como escritas, com dois ajustes: validar `p_cc`
por existência em `cost_centers` (não por formato) e decidir P1/P2 antes de escrever
`listar_mapa_lideres` e o gate.

**Bloqueio para a Fase 6.1:** P1 e P2 — as duas mudam a assinatura/corpo das RPCs. P3/P4/P5 podem
correr em paralelo.

---

*Fim do Discovery da Fase 6. Nenhuma escrita foi feita no banco; nenhum arquivo de código alterado.*
