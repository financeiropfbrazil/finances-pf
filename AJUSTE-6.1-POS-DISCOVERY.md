# AJUSTE 6.1 — Fase 6 pós-Discovery
## Mapa de Líderes por Centro de Custo: decisões, SQL definitivo e espec de tela

> `FASE6-MAPA-LIDERES-CC.md` permanece INTACTO. Este Ajuste **substitui os §5 e §6** daquela
> especificação e responde às perguntas P1–P5. Em conflito, **vale este arquivo**.
> Base: `DISCOVERY-FASE6.md` (commit 8134797) + decisões do Pedro de 10/08/2026.

---

## 1. Respostas a P1–P5

| # | Pergunta | Decisão |
|---|---|---|
| **P1** | Universo de CCs (denominador da cobertura) | **(a) os 81 `is_active=true AND group_type='F'`** — mesma fonte do wizard. Os 14 CCs do bloco `00001.*` (renumerados em 17/05/2026) **não entram**: apareceriam como "sem líder" para sempre e falsificariam a cobertura |
| **P2** | Gate da tela e das RPCs | **`is_admin`, reusando `hub_caller_is_admin()`**. Motivo: as RPCs `hub_*` gateiam por `is_admin`; gatear a tela por `admin.users.manage` criaria uma tela meio-viva (usuário vê a tela, o seletor explode com 42501). Coerência com `settings/Users.tsx`. **Não criar permissão nova** |
| **P3** | Espelho congelado desde 30/07 + sync fora do gateway | **(b)** — a tela exibe **"Espelho de centros de custo atualizado em ⟨data⟩"**, com destaque se > 7 dias. Corrigir o sync é **missão própria** (dívida §6) |
| **P4** | `cost_centers` gravável/deletável por qualquer autenticado, sem FK | **Dívida registrada** (§6). Mitigação barata **nesta fase**: `listar_mapa_lideres` devolve também os **mapeamentos órfãos** (CC que não existe mais ou saiu do universo ativo), sinalizados na tela |
| **P5** | Validação com zero requisições pendentes | **Não criar requisição de teste em produção.** O passo "pendentes intactas" é provado por leitura da RPC (não toca `compras_requisicoes`) + `count` antes/depois |

---

## 2. Correções à especificação original (as 8 contradições do Discovery)

1. **Fonte de dados:** `public.cost_centers` (182 linhas, chave `erp_code`), **não** `rh_centros_custo`. A query do F-D1 da espec era cega para ela (nome em inglês) e apontava a tabela errada — caso do padrão LIVRO × ESPELHO.
2. **Validação de `p_cc`:** por **existência em `cost_centers`** (`is_active AND group_type='F'`). **NUNCA regex de formato** — 4 CCs ativos fogem do padrão 3×5 dígitos (`00010.00002.00007.00001` tem 4 níveis; `00008.00002.000012` tem 6 dígitos no último nível).
3. **Universo do §5.4:** os 81 ativos-folha (P1), não os 43 derivados das requisições.
4. **Gate:** `hub_caller_is_admin()` (P2).
5. **Aviso de pendentes:** mantido no contrato, mas será 0 em todo cenário hoje (P5) — não é defeito.
6. **Descrição do CC:** vem de `cost_centers.name` via join. **Nunca** de `compras_requisicoes.centro_ctrl_nome` (preenchido em 4 de 309 linhas).
7. **`atribuido_em`:** nasce nulável (linhas existentes não têm valor). Backfill da única linha existente entra no SQL; endurecer para NOT NULL fica como opção futura.
8. **`cost_centers` sem trava:** reconhecido (P4). O mapa repousa sobre tabela gravável — daí a linha de órfãos.

---

## 3. SQL da Fase 6.1 (Claude escreve o arquivo; Pedro executa no SQL Editor)

⚠️ **TAGS NOMEADAS OBRIGATÓRIAS** em todo CREATE FUNCTION (`$a1$`, `$r1$`, `$l1$`) — o SQL Editor
corrompe corpos `$$` em silêncio. Statements atômicos, um por Run. `notify pgrst` ao final.

### 3.1 Colunas de auditoria + backfill

```sql
alter table public.compras_lideres_cc
  add column if not exists atribuido_por uuid,
  add column if not exists atribuido_em timestamptz,
  add column if not exists revogado_por uuid,
  add column if not exists revogado_em timestamptz,
  add column if not exists motivo text;
```

```sql
update public.compras_lideres_cc
   set atribuido_em = coalesce(atribuido_em, created_at),
       motivo = coalesce(motivo, 'Seed piloto — Fase 1')
 where atribuido_em is null
returning id, codigo_centro_ctrl, atribuido_em;
```

### 3.2 `atribuir_lider_cc(p_user_id uuid, p_cc text, p_motivo text default null)`

Comportamento (SECURITY DEFINER, `set search_path = public`, tag `$a1$`):

1. `if not public.hub_caller_is_admin() then return 'SEM_PERMISSAO'; end if;`
2. `p_user_id` existe em `profiles` → senão `USUARIO_INVALIDO`.
3. `p_cc` existe em `cost_centers` **com `is_active` e `group_type='F'`** → senão `CC_INVALIDO`.
   (Existência, nunca formato — correção §2.2.)
4. Upsert em `compras_lideres_cc` por `(lider_user_id, codigo_centro_ctrl)`:
   - já existe → reativa (`ativo=true`, `revogado_por=null`, `revogado_em=null`,
     `atribuido_por=auth.uid()`, `atribuido_em=now()`, `motivo=p_motivo`);
   - não existe → insere com os mesmos campos.
5. Garante o papel `lider_departamento` ativo em `hub_user_roles` (insere se não houver ativo, com
   `atribuido_por=auth.uid()`, `atribuido_em=now()`, `motivo`). **Não** usa `hub_assign_role` (que é
   composta e protege admin — nada disso se aplica aqui), mas preenche os mesmos campos.
6. Retorna `'OK'`.

### 3.3 `revogar_lider_cc(p_user_id uuid, p_cc text)`

(SECURITY DEFINER, tag `$r1$`)

1. Mesmo gate `hub_caller_is_admin()`.
2. Linha existe e está ativa → senão `NAO_ENCONTRADA`.
3. **Soft-delete:** `ativo=false`, `revogado_por=auth.uid()`, `revogado_em=now()`.
4. Se o usuário **não** liderar mais nenhum CC ativo → revogar `lider_departamento` em
   `hub_user_roles` (`revogado_por`, `revogado_em`), soft-delete, nunca DELETE.
5. Retorna `'OK:' || n` onde `n` = requisições `pendente_aprovacao` naquele CC (**informativo**;
   nenhuma é alterada — F5). Hoje sempre 0 (P5).

### 3.4 `listar_mapa_lideres()` — retorna TABLE

(SECURITY DEFINER, tag `$l1$`. Gate: `hub_caller_is_admin()` → sem permissão, retorna 0 linhas.)

Colunas por linha:

| Coluna | Conteúdo |
|---|---|
| `erp_code` | código do CC |
| `nome` | `cost_centers.name` |
| `department_type` | para agrupar/filtrar |
| `lideres` | agregado (nome + e-mail) dos líderes **ativos** daquele CC; vazio = sem líder |
| `qtd_lideres` | inteiro |
| `pendentes` | requisições `pendente_aprovacao` naquele CC |
| `total_reqs` | requisições no CC (qualquer status) — mostra relevância |
| `orfao` | **`false`** para os 81 do universo |

**Universo:** os 81 `is_active AND group_type='F'` (P1) — **mais** as linhas **órfãs** (P4): qualquer
`compras_lideres_cc` ativo cujo `codigo_centro_ctrl` **não** esteja nesse universo entra como linha
extra com `orfao=true` e `nome` = `'(centro de custo inexistente ou inativo)'`. É o alerta de que um
CC mapeado foi apagado, expirou ou virou totalizador.

Ordenação sugerida: órfãos primeiro, depois sem líder com mais requisições, depois o resto por nome.

### 3.5 RLS

`compras_lideres_cc` continua **sem policies de escrita** — toda escrita passa pelas RPCs
`SECURITY DEFINER`. `grant execute … to authenticated` nas três (o gate está no corpo).

### 3.6 Gate de saída do SQL

1. 5 colunas novas em `compras_lideres_cc`; linha do piloto com `atribuido_em` preenchido.
2. As 3 funções em `information_schema.routines`, `prosecdef=true`, `search_path=public`.
3. `select listar_mapa_lideres();` no SQL Editor → **0 linhas** (não há `auth.uid()`; prova o gate).
4. `select atribuir_lider_cc(gen_random_uuid(),'x');` → `SEM_PERMISSAO`.
5. `notify pgrst, 'reload schema';` por último.

---

## 4. Tela (substitui o §6 da espec)

- **Rota** `/settings/lideres-cc` (junto das demais administrativas), **item de menu com
  `adminOnly: true`**, escondido por `!isAdmin` — molde de `settings/Users.tsx`.
- **Gate na página:** early return com card "Acesso restrito a administradores." (mesmo padrão).
- **Cabeçalho:** título + **"Espelho de centros de custo atualizado em ⟨max(updated_at)⟩"**, com
  destaque visual se > 7 dias (P3). Link para a tela de CCs, onde fica o botão de sincronizar.
- **Indicador de cobertura:** "X de 81 centros de custo com líder definido" + percentual.
- **Tabela:** uma linha por CC — código, nome, líder(es), nº de requisições no CC, pendentes, ação.
  Linhas **órfãs** no topo, com alerta visual explicando o que significa.
- **Filtros:** busca por código/nome · alternador **"Somente sem líder"** (a leitura de controle
  interno) · opcionalmente por `department_type`.
- **Atribuir:** seletor de usuário via `hub_list_users_with_roles()` (coerente com o gate `is_admin`
  — P2) → `rpc('atribuir_lider_cc')`. Feedback deve dizer que **o papel `lider_departamento` foi
  concedido junto**.
- **Remover:** confirmação informando quantas requisições pendentes existem no CC e que **não serão
  alteradas** → `rpc('revogar_lider_cc')`.
- **Vários CCs por líder** é o caso normal (um líder aparece em várias linhas). Opcional: visão
  secundária "por líder", agrupada — só se sair barato.
- **Histórico:** toggle "mostrar inativos" exibindo mapeamentos revogados (quem liderava, quando saiu).
- Tratar todos os retornos com mensagem visível (`SEM_PERMISSAO`, `USUARIO_INVALIDO`, `CC_INVALIDO`,
  `NAO_ENCONTRADA`, `OK:n`). **Sem `.update()` direto** — só RPC.

---

## 5. Gate de saída da fase

1. `bun run build` limpo · `tsc --noEmit` sem erros novos.
2. Tela invisível e inacessível para não-admin (**testar com o Hugo**, já que Pedro é o único
   `is_admin` e o bypass mascara erro de permissão).
3. Atribuir → mapeamento **e** papel criados; remover → ambos revogados (soft-delete), e
   `select count(*) from compras_requisicoes where status='pendente_aprovacao'` **inalterado**
   antes/depois (P5).
4. Cobertura bate: `select count(*) from cost_centers where is_active and group_type='F'` = 81.
5. Commit com staging explícito, **sem push** até revisão.

---

## 6. Dívidas registradas nesta fase

> **DÍVIDA-RLS-COST-CENTERS** — `cost_centers` tem policy `ALL using(true)` para `authenticated`:
> qualquer usuário logado pode INSERT/UPDATE/**DELETE** via API, e a tela `settings/CostCenters.tsx`
> expõe `.delete()` físico. Como não há FK para `compras_lideres_cc`, apagar um CC deixa o
> mapeamento de liderança órfão. **Mitigado nesta fase apenas na visualização** (linha `orfao`).
> Prioridade: alta — vai junto com **DÍVIDA-RLS-COMPRAS-REQ**.

> **DÍVIDA-SYNC-CC-FORA-DO-GATEWAY** — o sync de centros de custo chama
> `https://pef.it4you.inf.br/api/CentroCtrl/RetornaListaCentroCtrl` **direto do navegador**, contra a
> regra do `CLAUDE.md` (toda chamada ao Alvo passa pelo `erp-proxy`). Rodou **uma única vez**
> (30/07/2026) e nunca mais — todos os 182 registros têm `updated_at` idêntico ao milissegundo, o que
> sugere que o botão pode estar quebrado. **Missão própria:** levar o sync ao gateway + cron.
> Prioridade: média-alta (o mapa de alçadas retrata o Alvo de 30/07).

> **DÍVIDA-REVOKE-PUBLIC** (herdada) — `revoke execute … from public` nas RPCs da missão; a regra do
> `CLAUDE.md` menciona só `anon`, mas o Postgres concede a `PUBLIC` por padrão. Sem risco prático
> (guarda `auth.uid() is null`), mas incompleto. **As 3 RPCs desta fase nascem com o mesmo padrão** —
> tratar todas de uma vez.

---

## 7. Fora de escopo

Editar/criar/apagar centros de custo · corrigir o sync · fechar as RLS · alçada por valor ·
escalonamento/SLA/notificações · permissão `compras.lideres.manage` própria (só quando existir um
segundo administrador) · tela de administração do catálogo de motivos de rejeição.

---

## 8. PROMPT 6.1 — colar na sessão do Claude Code

```
PROMPT 6.1 — Fase 6.1 (SQL + tela do Mapa de Líderes por CC)

Leia, nesta ordem: CLAUDE.md (protocolo de início) → ESTADO-APROVACAO-REQ.md
→ FASE6-MAPA-LIDERES-CC.md (espec original) → AJUSTE-6.1-POS-DISCOVERY.md (ESTE MANDA em
conflito; é o escopo da sessão) → DISCOVERY-FASE6.md (seus próprios achados).

Decisões fechadas: P1=(a) 81 CCs is_active+group_type='F' · P2=is_admin via hub_caller_is_admin()
· P3=(b) mostrar data do espelho na tela · P4=dívida + linha de órfãos · P5=sem requisição de teste.

Entregue nesta ordem:
1. Um arquivo SQL-FASE61.md na raiz com TODOS os blocos SQL do §3 do Ajuste, prontos para eu colar,
   um statement por bloco, na ordem, com resultado esperado de cada um e o gate §3.6 ao final.
   ⚠️ TAGS NOMEADAS OBRIGATÓRIAS em todo CREATE FUNCTION ($a1$, $r1$, $l1$) — o SQL Editor corrompe
   corpos $$ em silêncio. NÃO execute nada: o MCP é read-only e a execução é minha.
   Antes de escrever, leia o pg_get_functiondef de hub_caller_is_admin, hub_list_users_with_roles,
   hub_assign_role e hub_revoke_role para seguir o contrato real do Hub (não a minha descrição).
2. A tela do §4 do Ajuste, seguindo o molde de src/pages/settings/Users.tsx (gate, card de acesso
   restrito, escrita só por RPC, toasts).

NÃO TOCAR: banco (escrita), cost_centers (nem a tela dela), crons/Edge Functions, types.ts,
o fluxo de aprovação já em produção, arquivos de outras missões no working tree.

Gate de saída: §5 do Ajuste. Git: staging explícito, commit
"feat(suprimentos): mapa de lideres por centro de custo (FASE 6.1)". SEM push.
Atualize o ESTADO-APROVACAO-REQ.md. Termine com: arquivos alterados, o contrato real das RPCs hub_*
que você leu, e o que contradisse a espec.
```

---

*Fim do Ajuste 6.1. Depois: eu executo o SQL, revisão, push, Publicar, validação §5 (com o Hugo para
o teste de não-admin).*
