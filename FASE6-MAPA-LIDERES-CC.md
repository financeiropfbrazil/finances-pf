# FASE 6 — Mapa de Líderes por Centro de Custo (tela de administração)
## Missão Aprovação de Requisições · especificação

> Guia v2, Ajuste 1.1, Ajuste 1.2 e PROMPT-3-FASE3 permanecem INTACTOS. Este arquivo é a
> especificação da Fase 6 e manda em conflito **dentro do seu escopo**.
> **Pré-requisito:** validação da Fase 5 (com Hugo Maffei) concluída com sucesso. Não construir
> a tela de administração de um controle antes de provar que o controle funciona.

---

## 1. Problema

O mapeamento líder↔CC vive só na tabela `compras_lideres_cc`, **sem policies de escrita** — a
gestão é exclusivamente por `insert` manual no SQL Editor. Isso funcionou no piloto (1 CC), mas:

- expandir para cada departamento exige uma sessão de SQL;
- trocas de liderança, ausências e reestruturação viram fila de pedidos técnicos;
- **o mapa de alçadas é conhecimento tácito de quem tem acesso ao banco** — não há artefato
  consultável para auditoria, e ninguém no negócio consegue responder "quem aprova o quê?" sem
  perguntar ao Controller;
- não há visão de **cobertura**: quais CCs estão sob controle e quais passam direto pelo gate.

## 2. Objetivo

Uma tela em Suprimentos (ou Configurações, conforme D-A) onde um administrador vê **todos os
centros de custo**, quem lidera cada um, e atribui/remove liderança — com o papel RBAC concedido
no mesmo ato, sem depender de lembrar de um segundo passo.

**Ganho de controle interno:** o mapa de alçadas passa a ser um artefato visível, exportável e
auditável, em vez de linhas numa tabela do banco.

---

## 3. Decisões travadas (Pedro, 10/08/2026)

| # | Tema | Decisão |
|---|---|---|
| F1 | Quem administra | Somente `admin.users.manage` (hoje: Pedro). Não criar permissão nova sem necessidade — validar na Fase 0 se convém `compras.lideres.manage` própria |
| F2 | Papel RBAC | Atribuir/revogar `lider_departamento` **junto** com o mapeamento, na mesma RPC — nunca dois passos manuais |
| F3 | Vários CCs por líder | Suportado (já é a chave da tabela). Vários líderes por CC também — é o mecanismo de substituto |
| F4 | Remoção | **Soft-delete** (`ativo=false`), nunca DELETE — preserva a trilha de quem liderava quando |
| F5 | Efeito em requisições pendentes | Remover um líder **não** mexe em requisição já pendente. A tela deve avisar quantas ficarão sem aprovador daquele líder |
| F6 | Escopo | Somente administração do mapa. **Não** entra: alçada por valor, escalonamento, SLA, notificações |

---

## 4. FASE 6.0 — Discovery (read-only, antes de qualquer SQL ou código)

Saída: seção nova no `ESTADO-APROVACAO-REQ.md` (ou `DISCOVERY-FASE6.md`), respondendo:

```sql
-- F-D1. De onde vem a lista de centros de custo? Existe tabela espelho no Hub?
select table_name from information_schema.tables
where table_schema='public' and (table_name ilike '%centro%' or table_name ilike '%cc%'
      or table_name ilike '%custo%' or table_name ilike '%ctrl%');

-- F-D2. Formato e cardinalidade reais dos CCs em uso nas requisições
select codigo_centro_ctrl, count(*) from compras_requisicoes
group by 1 order by 2 desc;

-- F-D3. Estado atual do mapeamento e do papel
select * from compras_lideres_cc order by created_at;
select p.email, ur.atribuido_em, ur.revogado_em
from hub_user_roles ur join hub_roles r on r.id=ur.role_id
join profiles p on p.user_id=ur.user_id
where r.codigo='lider_departamento' order by ur.atribuido_em;

-- F-D4. Quem pode administrar hoje
select p.email from hub_role_permissions rp
join hub_permissions perm on perm.id=rp.permission_id and perm.codigo='admin.users.manage'
join hub_roles r on r.id=rp.role_id
join hub_user_roles ur on ur.role_id=r.id and ur.revogado_em is null
join profiles p on p.user_id=ur.user_id;
select email from profiles where is_admin;
```

Investigações de código:
- **F-D5.** Existe tela/serviço que já liste centros de custo (o wizard tem um seletor de CC na
  etapa "Área" — de onde ele lê?). **Reusar essa fonte**, não criar outra.
- **F-D6.** Padrão de telas administrativas existentes no Hub (ex.: gestão de usuários/papéis) —
  seguir o mesmo molde de layout, gate e feedback.
- **F-D7.** Como os CCs são sincronizados do Alvo (há cron? é sob demanda?) e se há CCs inativos
  que não devem aparecer.

**Ponto crítico do Discovery:** se **não** houver tabela espelho de CCs no Hub, a tela precisará ou
consultar o Alvo em tempo real (via proxy) ou trabalhar sobre os CCs distintos observados nas
requisições — a decisão muda a arquitetura e deve ser reportada antes de codar.

---

## 5. FASE 6.1 — RPCs (Claude escreve; Pedro executa no SQL Editor)

⚠️ **Tags nomeadas obrigatórias** (`$m1$`, `$m2$`…) em todo CREATE FUNCTION — o SQL Editor corrompe
corpos `$$` em silêncio (armadilha registrada). Statements atômicos, `notify pgrst` ao final.

### 5.1 Ajuste de schema

```sql
alter table public.compras_lideres_cc
  add column if not exists atribuido_por uuid,
  add column if not exists atribuido_em timestamptz default now(),
  add column if not exists revogado_por uuid,
  add column if not exists revogado_em timestamptz;
```
Espelha o padrão de auditoria de `hub_user_roles` (soft-delete + quem/quando), que é o molde do Hub.

### 5.2 `atribuir_lider_cc(p_user_id uuid, p_cc text)` — SECURITY DEFINER

Comportamento:
1. Gate: `user_has_permission(auth.uid(), 'admin.users.manage')` → senão `SEM_PERMISSAO`.
2. Valida que `p_user_id` existe em `profiles` → senão `USUARIO_INVALIDO`.
3. Valida `p_cc` não vazio → senão `CC_INVALIDO`.
4. Upsert em `compras_lideres_cc`: se já existe (mesmo par), reativa (`ativo=true`, limpa
   `revogado_*`); senão insere com `atribuido_por=auth.uid()`.
5. **F2:** garante o papel `lider_departamento` ativo em `hub_user_roles` para esse usuário
   (insere se não houver ativo, com `atribuido_por` e `motivo`).
6. Retorna `OK` / código de erro.

### 5.3 `revogar_lider_cc(p_user_id uuid, p_cc text)` — SECURITY DEFINER

1. Mesmo gate.
2. **Soft-delete (F4):** `ativo=false`, `revogado_por=auth.uid()`, `revogado_em=now()`.
3. **Se o usuário não liderar mais nenhum CC ativo**, revogar também o papel `lider_departamento`
   (soft-delete em `hub_user_roles`, `revogado_em`) — coerência com F2 na direção inversa.
4. Retorna `OK` + (informativo) quantas requisições `pendente_aprovacao` existem naquele CC, para
   a UI avisar (**F5** — não altera nenhuma delas).

### 5.4 `listar_mapa_lideres()` — SECURITY DEFINER, retorna TABLE

Uma linha por CC conhecido (fonte definida no F-D1/F-D5), com: código do CC, descrição, líderes
ativos (nome/e-mail, agregados), nº de requisições pendentes, nº total de requisições.
**CCs sem líder aparecem** — são a visão de cobertura do controle.

### 5.5 RLS

`compras_lideres_cc` continua **sem policies de escrita** — toda escrita passa pelas RPCs
`SECURITY DEFINER`. O SELECT permanece como está (authenticated lê, necessário para o gate).

### 5.6 Gate de saída da Fase 6.1

Colunas de auditoria presentes; as 3 RPCs em `information_schema.routines`; chamadas sem contexto
de auth devolvem `SEM_PERMISSAO`; `listar_mapa_lideres()` devolve o piloto (`00010.00002.00003` →
Pedro) e os demais CCs sem líder; `notify pgrst` rodado por último.

---

## 6. FASE 6.2 — Tela

- **Rota nova** (`/suprimentos/lideres` ou equivalente), item de menu gateado por
  `admin.users.manage`.
- **Tabela principal:** um CC por linha — código, descrição, **líder(es) atual(is)**, nº de
  pendentes, ação.
- **Filtro rápido "sem líder"** — é a leitura de cobertura: esses CCs passam direto pelo gate.
- **Indicador de cobertura** no topo: X de Y CCs com líder definido.
- **Atribuir:** seletor de usuário (mesma fonte das telas de administração existentes) →
  `atribuir_lider_cc`. Feedback claro de que o papel RBAC foi concedido junto.
- **Remover:** confirmação que informa **quantas requisições pendentes** existem naquele CC e que
  elas **não** serão alteradas (F5) → `revogar_lider_cc`.
- **Histórico:** mostrar mapeamentos revogados (quem liderava, quando saiu) — pode ser um toggle
  "mostrar inativos", já que a tabela guarda soft-delete.
- Tratar todos os retornos das RPCs com mensagem visível. Fallback nunca silencioso.
- **Sem `.update()` direto** — só RPC (CORS bloqueia PATCH).

### 6.3 Gate de saída

Build/tsc limpos; tela invisível para quem não tem `admin.users.manage` (testar com usuário
não-admin — **Pedro é o único `is_admin`**, então o bypass mascara erro de permissão); atribuir e
revogar refletem em `compras_lideres_cc` **e** em `hub_user_roles`; requisições pendentes intactas
após revogação; commit com staging explícito, sem push até revisão.

---

## 7. Validação

1. Atribuir um líder de teste a um CC sem movimento → conferir mapeamento **e** papel concedido.
2. Esse usuário passa a ver o menu "Aprovações" (e só as pendências daquele CC).
3. Revogar → papel revogado (se não liderar mais nada), menu some, **requisições pendentes daquele
   CC continuam intactas** e ainda decidíveis pelo admin.
4. Filtro "sem líder" bate com a realidade do mapa.
5. Nenhum status de requisição alterado em todo o exercício.

## 8. Fora de escopo

Alçada por valor · escalonamento/SLA/lembretes · notificações · gate para requisições nativas do
Alvo · **DÍVIDA-RLS-COMPRAS-REQ** (missão própria) · edição de centros de custo (são do Alvo, o Hub
só espelha).

## 9. Prompts

| Prompt | Conteúdo | Executor |
|---|---|---|
| **PROMPT 6.0** | Discovery F-D1…F-D7, sem código | Claude Code (read-only) |
| **PROMPT 6.1** | SQL: colunas de auditoria + 3 RPCs (tags nomeadas) | Claude escreve, Pedro executa |
| **PROMPT 6.2** | Tela + integração | Claude Code + push + Publicar |
| **PROMPT 6.3** | Validação §7 | Pedro (+ usuário de teste sem is_admin) |

---

*Fim da especificação da Fase 6. Pré-requisito: Fase 5 validada. O mapa de alçadas deixa de ser
conhecimento de banco e passa a ser artefato auditável.*
