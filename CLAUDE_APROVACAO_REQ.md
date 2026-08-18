# CLAUDE_APROVACAO_REQ.md — Missão: Aprovação de Requisições pelo Líder de Departamento
## v2 — 06/08/2026 (decisões do Pedro incorporadas)

> Guia operacional para **Claude Code** (workflow FH47: PowerShell + MCP Supabase read-only + git push→Lovable).
> Repo: `C:\Users\PFBR-2601-3\finances-pf` · Supabase: `hbtggrbauguukewiknew`
> Referências: `Requisicoes_e_Compras.md` (módulo, FH47) · `Permissoes_e_Roles_v2.md` (RBAC) · `relatorio-erp-proxy.md` (proxy)
> **Convenção de prompts:** cada FASE vira um prompt numerado e **imutável** após criado. Mudou? Prompt novo (Ajuste N.x), original intacto.

### Changelog v1 → v2 (v1 substituída antes de qualquer prompt rodar)

| Tema | v1 | v2 |
|---|---|---|
| Quem aprova | Tabela `setores` + `profiles.setor_id` | **Papel RBAC `lider_departamento` + mapeamento líder↔centro de custo** (`compras_lideres_cc`). A req roteia pelo **`codigo_centro_ctrl` dela** (etapa "Área" do wizard) |
| Rollout | Big-bang com feature de seed | **O mapeamento É a chave de rollout:** CC sem líder mapeado → fluxo legado (direto ao Alvo). Piloto = mapear só o Financeiro (Pedro) |
| Req do líder | Pendente + ele aprova | **Pula o gate:** auto-aprovação com registro (`aprovacao_automatica=true`) |
| E-mails | Fase 4 (recomendada) | **REMOVIDOS** — decisão gerencial: não avisar pendências. Futuro só sob pedido |
| Clonar | Só para rejeitadas | **"Clonar para Nova Requisição" em TODAS as reqs** (qualquer status) → gera rascunho novo |
| Rascunho | Assumido existente | **A confirmar na Fase 0**; se não houver rascunho persistente/visível, criar ("Salvar rascunho" + lista) |
| Auditoria | Colunas OU tabela de eventos | **Colunas na própria `compras_requisicoes`** (interpretação de "só as tabelas" — vetável) |
| Permissões | Genérico | Integrado ao RBAC real: nova permissão `compras.requisicoes.aprovar`, checklist §8 do report de Permissões, **mapear também ao papel `admin`** (lição das 13 órfãs, §9.1) |

---

## 1. Decisões travadas (respostas do Pedro, 06/08)

1. Gate só para reqs **nascidas no Hub**. Nativas do Alvo: descobertas como hoje, sem gate.
2. **Todas** as reqs, sem alçada de valor.
3. **2 botões** (APROVAR | REJEITAR). Rejeitada é **terminal**. Reaproveitamento = botão **"Clonar para Nova Requisição"**, disponível em toda req.
4. Aprovador = **líder(es) do centro de custo da requisição** (campo da etapa "Área", pré-preenchido do funcionário, editável). Líder = usuário com papel `lider_departamento` + linha(s) em `compras_lideres_cc`.
5. Um líder pode controlar **vários CCs** (tabela N:N; um CC também aceita mais de um líder — cobre substituto sem mudar schema).
6. Req criada por líder mapeado no CC dela: **pula o gate** — auto-aprovação registrada.
7. Pedro = líder do Financeiro; entra na regra 6 (o `is_admin` dele NÃO auto-aprova CCs alheios — só decide pendências como bypass).
8. Cria req quem tem papel `requisitante` (RBAC existente).
9. Padrão de permissão = RBAC do Hub (`Permissoes_e_Roles_v2.md`). Pergunta sobre "Atualizar Cadastros" superada.
10. Rota de envio ao Alvo: **incógnita D8** — `req-comp.ts` existe no proxy mas não foi inspecionado. Plano em §4.2.
11. Rascunho de requisição: não visível hoje → **confirmar e, se faltar, criar**.
12. Trilha: **colunas na req** (sem tabela de eventos).
13. **Sem e-mails** nesta missão (decisão gerencial).
14. **Piloto: Financeiro** (CC CONTROLADORIA/FINANCEIRO `00010.00002.00003` — confirmar se há mais CCs do Financeiro no seed).

---

## 2. Regras de engajamento (inegociáveis — herdadas do FH47)

1. **`git pull` antes de tudo.** O código vivo está no Lovable.
2. **MCP Supabase hospedado, read-only** (máquina sem Node.js):
   `https://mcp.supabase.com/mcp?project_ref=hbtggrbauguukewiknew&read_only=true&features=database`
   Agente **lê** sozinho; **toda escrita (DDL/DML) é do humano** no SQL Editor.
3. **Blindagem de commit:** PROIBIDO `git add -A` / `git add .` / `git commit -a`. Staging individual, `git status` antes de cada commit. `types.ts` em skip-worktree — não tocar. Sobras de outras sessões no working tree — ignorar.
4. **Push → conferir no editor do Lovable → `Publicar` manual.**
5. **SQL:** DDL em statements atômicos separados (SQL Editor abandona `BEGIN/COMMIT` em silêncio). DML: `BEGIN … SELECT conferência … ROLLBACK` (dry-run) → `COMMIT` separado. `RETURNING` em UPDATE. **`NOTIFY pgrst, 'reload schema';` após todo DDL.**
6. **NUNCA `supabase db push`.**
7. **Frontend nunca `.update()`** (CORS bloqueia PATCH) — `.upsert(onConflict)` ou **RPC via POST**.
8. **`CREATE OR REPLACE` não preserva `SECURITY DEFINER`/`search_path`** — sempre redeclarar. `DROP FUNCTION` antes de mudar assinatura.
9. **Fallbacks gritam**, nunca degradam em silêncio.
10. **Uma fase por vez**; gate de saída validado antes de avançar.
11. **Serializar DDL** com qualquer outro agente no mesmo banco.
12. **Checklist RBAC (§8 do report de Permissões) em toda ação nova:** permissão criada → mapeada aos papéis **incluindo `admin`** → gate de UI (`get_user_permissions`) → **gate de backend (`user_has_permission`) na RPC** → respeitar own/all.
13. ⚠️ **Pedro é o ÚNICO `is_admin` (§9.3)** — bypass esconde erro de permissão. **Toda tela/RPC nova é testada com usuário sem `is_admin`.**

---

## 3. Máquina de estados e roteamento

`compras_requisicoes.status` é **text** (confirmar na Fase 0) — sem `ALTER TYPE`.

```
SUBMISSÃO (wizard, etapa Revisão) — RPC submeter_requisicao decide a rota pelo CC da req:

  CC SEM líder mapeado ─────────► 'SEM_GATE'      → fluxo legado: envio direto ao Alvo → sincronizada
  Criador É líder do CC ────────► 'AUTO_APROVADA' → aprovada (auto, registrada) → envio → sincronizada
  CC COM líder (criador não é) ─► 'PENDENTE'      → pendente_aprovacao (não vai ao Alvo; operadoras não veem)

FILA DO LÍDER (pendente_aprovacao, CCs mapeados dele):
  [APROVAR]  → aprovada ──envio──► sincronizada ──► (fluxo atual: operadoras, pedido, baixa…)
                  └─ envio falha ──► aprovada + erro_envio  → botão Reenviar (sem nova aprovação)
  [REJEITAR + motivo obrigatório] → rejeitada  (TERMINAL — nunca toca o Alvo)

Req nativa do Alvo: descoberta (Job 4) → sincronizada (inalterado, sem gate)
Clonar para Nova Requisição: qualquer req, qualquer status → novo rascunho do usuário atual
```

Regras derivadas:
- `pendente_aprovacao` / `aprovada` / `rejeitada` **não têm `numero_alvo`** → todo sync/open-load as ignora (guarda `numero_alvo is not null`).
- `rejeitada` entra no conjunto **terminal** da guarda anti-rebaixamento do Job 4.
- Fila das operadoras continua filtrando `sincronizada` — pendentes invisíveis por construção (verificar vazamentos na Fase 0).
- O CC é **editável** no wizard → o aprovador segue o **CC onerado**, não o setor do criador. Consequência consciente: trocar o CC muda o líder (ou sai do gate no piloto). Ver §10 (riscos).

---

## 4. FASE 0 — Discovery (100% read-only)

Saída: `DISCOVERY-APROVACAO-REQ.md` na raiz + **adendo ao `relatorio-erp-proxy.md`** (rotas reais do `req-comp.ts`).

### 4.1 Banco (via MCP read-only)

```sql
-- D1. Esquema real de compras_requisicoes (status text? erro_envio existe? requisitante_user_id? codigo_centro_ctrl?)
select column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema='public' and table_name='compras_requisicoes' order by ordinal_position;

-- D2. Domínio REAL de status hoje (rascunho existe? 'rascunho (erro)' é literal?)
select status, count(*) from compras_requisicoes group by 1 order by 2 desc;

-- D3. Formato real do codigo_centro_ctrl nas reqs (bate com '00010.00002.00003'?) + cobertura
select codigo_centro_ctrl, count(*) from compras_requisicoes group by 1 order by 2 desc limit 30;
select count(*) total, count(codigo_centro_ctrl) com_cc from compras_requisicoes;

-- D4. RLS COMPLETA da família (SELECT/INSERT/UPDATE): quem lê/escreve o quê hoje?
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('compras_requisicoes','compras_requisicoes_itens',
                    'compras_requisicoes_itens_classe_rec_desp','compras_requisicoes_arquivos')
order by tablename, cmd;

-- D5. profiles: user_id único? is_admin? (chave canônica = user_id = auth.uid())
select count(*) total, count(distinct user_id) distintos from profiles;

-- D6. Colisão de nomes de RPC + shape das funções RBAC
select routine_name from information_schema.routines
where routine_schema='public' and (routine_name ilike '%requisi%' or routine_name ilike '%permission%');

-- D7. Catálogo RBAC: confirmar códigos exatos e ids (para o seed da Fase 1)
select codigo, nome, modulo from hub_permissions where modulo='compras' order by codigo;
select codigo, nome, is_system from hub_roles order by codigo;

-- D8-pré. Como as reqs do Hub se distinguem das nativas hoje
select (requisitante_user_id is not null) tem_requisitante, (numero_alvo is null) sem_numero, status, count(*)
from compras_requisicoes group by 1,2,3 order by 4 desc;
```

### 4.2 D8 — a rota de envio Hub→Alvo da requisição (em 2 etapas)

**Etapa 1 (frontend, resolve na maioria dos casos):** grep no repo por `compras_requisicoes` → achar o service de requisições; dentro dele, achar a função de envio/reenvio (pista: a permissão `compras.requisicoes.reenviar_own` implica que ela existe) e **a URL do proxy que ela chama** (`req-comp/...`? rota genérica em `alvo.ts`?). Registrar: arquivo, função, rota, payload, e **como o sucesso é persistido** (quem seta `numero_alvo` + status — importa para o D4/UPDATE).

PowerShell de apoio:
```powershell
Get-ChildItem -Recurse -Include *.ts,*.tsx | Select-String -Pattern "compras_requisicoes" | Select-Object Path -Unique
Get-ChildItem -Recurse -Include *.ts,*.tsx | Select-String -Pattern "req-comp" | Select-Object Path, LineNumber, Line
```

**Etapa 2 (se a rota não se revelar):** PARAR e pedir ao Pedro os arquivos `src/routes/req-comp.ts`, `src/routes/alvo.ts` e `src/index.ts` do GitHub Web do erp-proxy. Com eles, fechar o adendo do report do proxy.

### 4.3 Demais investigações de código

- **D9. Pontos que filtram status de req:** grep pelos literais `'sincronizada'`, `'rascunho'`, `'convertida_pedido'`, `'cancelada'` em `src/` e `supabase/functions/`. Listar arquivo+linha (auditoria nas Fases 2/3 — nada pode vazar pendentes nem quebrar com status novos; atenção à armadilha `NOT IN`/`neq` + NULL).
- **D10. Jobs 1/4 e `sincronizarStatusRequisicao`:** confirmar chaveamento por `numero_alvo` e onde vive o conjunto terminal anti-rebaixamento.
- **D11. Wizard "Nova Requisição":** onde vive (componente), o que o botão final faz hoje (persiste rascunho antes do envio? envia direto?), e onde plugar: (a) roteamento da submissão; (b) "Salvar rascunho" se faltar.
- **D12. Navegação/menu:** como telas são gateadas por permissão (`get_user_permissions`) — molde para a fila do líder.
- **D13. Fila das operadoras:** qual query lista reqs disponíveis (garantir que só `sincronizada` entra).

### 4.4 Gate de saída da Fase 0

`DISCOVERY-APROVACAO-REQ.md` com D1–D13 respondidos; adendo do proxy escrito; **decisão de desenho residual fechada com o Pedro:** lista de CCs do Financeiro para o seed (mínimo: `00010.00002.00003`).

---

## 5. FASE 1 — RBAC + Schema + RPCs (Claude escreve; Pedro executa no SQL Editor)

Statements atômicos. Ajustar aos achados (nomes de coluna de `hub_permissions`/`hub_roles` confirmados no D7).

### 5.1 RBAC — permissão nova + papel novo

```sql
-- 1.1 Permissão (padrão modulo.recurso.acao)
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.requisicoes.aprovar', 'Aprovar Requisições',
       'Aprovar/rejeitar requisições pendentes dos centros de custo sob sua liderança', 'compras'
where not exists (select 1 from hub_permissions where codigo='compras.requisicoes.aprovar');

-- 1.2 Papel Líder de Departamento
insert into hub_roles (codigo, nome, descricao, modulo, is_system)
select 'lider_departamento', 'Líder de Departamento',
       'Aprova requisições de compra dos centros de custo que lidera', 'compras', false
where not exists (select 1 from hub_roles where codigo='lider_departamento');

-- 1.3 Permissões do papel: access (gatekeeper do módulo) + aprovar
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='lider_departamento' and p.codigo in ('compras.requisicoes.access','compras.requisicoes.aprovar')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

-- 1.4 ⚠️ Lição §9.1: mapear a permissão nova TAMBÉM ao papel admin
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='admin' and p.codigo='compras.requisicoes.aprovar'
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```

### 5.2 Mapeamento líder ↔ centro de custo (a chave de rollout)

```sql
create table if not exists public.compras_lideres_cc (
  id uuid primary key default gen_random_uuid(),
  lider_user_id uuid not null,            -- = profiles.user_id = auth.uid()
  codigo_centro_ctrl text not null,       -- mesmo formato da req (D3), ex. '00010.00002.00003'
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lider_user_id, codigo_centro_ctrl)
);

alter table public.compras_lideres_cc enable row level security;
create policy lideres_cc_select on public.compras_lideres_cc
  for select to authenticated using (true);
-- Sem policy de INSERT/UPDATE/DELETE: gestão só via SQL Editor (admin), por enquanto.
```

### 5.3 Colunas de decisão na requisição (trilha = colunas, decisão 12)

```sql
alter table public.compras_requisicoes
  add column if not exists aprovada_por_user_id uuid,
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovacao_automatica boolean not null default false,
  add column if not exists rejeitada_por_user_id uuid,
  add column if not exists rejeitada_em timestamptz,
  add column if not exists motivo_rejeicao text;

-- Só se D1 mostrar que não existe:
alter table public.compras_requisicoes add column if not exists erro_envio jsonb;
```

```sql
notify pgrst, 'reload schema';
```

### 5.4 RPCs (SECURITY DEFINER, POST — nunca PATCH; gate RBAC dentro, checklist §8)

```sql
-- 2.1 Submissão com roteamento (chamada pelo wizard no lugar do envio direto)
drop function if exists public.submeter_requisicao(uuid);
create function public.submeter_requisicao(p_req_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_is_lider boolean;
  v_tem_lider boolean;
begin
  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'rascunho' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  -- só o dono (ou admin) submete; e precisa poder criar req
  if v_req.requisitante_user_id is distinct from auth.uid()
     and not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then
    return 'NAO_AUTORIZADO';
  end if;
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.create') then
    return 'SEM_PERMISSAO';
  end if;

  if v_req.codigo_centro_ctrl is null then return 'SEM_CENTRO_CUSTO'; end if;

  select exists (select 1 from compras_lideres_cc
                  where codigo_centro_ctrl = v_req.codigo_centro_ctrl and ativo)
    into v_tem_lider;
  if not v_tem_lider then
    return 'SEM_GATE';   -- rollout: CC não mapeado → frontend segue o envio legado ao Alvo
  end if;

  select exists (select 1 from compras_lideres_cc
                  where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                    and lider_user_id = auth.uid() and ativo)
    into v_is_lider;
  if v_is_lider then
    update compras_requisicoes
       set status='aprovada', aprovada_por_user_id=auth.uid(), aprovada_em=now(),
           aprovacao_automatica=true, updated_at=now()
     where id = p_req_id;
    return 'AUTO_APROVADA';  -- frontend segue direto para o envio ao Alvo
  end if;

  update compras_requisicoes
     set status='pendente_aprovacao', updated_at=now()
   where id = p_req_id;
  return 'PENDENTE';
end;
$$;

-- 2.2 Líder aprova (gate RBAC + escopo por CC; is_admin decide qualquer CC)
drop function if exists public.aprovar_requisicao(uuid);
create function public.aprovar_requisicao(p_req_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_admin boolean;
begin
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  select coalesce(is_admin,false) into v_admin from profiles where user_id = auth.uid();
  if not v_admin and not exists (
      select 1 from compras_lideres_cc
       where codigo_centro_ctrl = v_req.codigo_centro_ctrl
         and lider_user_id = auth.uid() and ativo) then
    return 'FORA_DO_SEU_CC';
  end if;

  update compras_requisicoes
     set status='aprovada', aprovada_por_user_id=auth.uid(), aprovada_em=now(),
         aprovacao_automatica=false, updated_at=now()
   where id = p_req_id;
  return 'OK';
end;
$$;

-- 2.3 Líder rejeita (motivo obrigatório; terminal)
drop function if exists public.rejeitar_requisicao(uuid, text);
create function public.rejeitar_requisicao(p_req_id uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_admin boolean;
begin
  if p_motivo is null or length(trim(p_motivo)) < 5 then return 'MOTIVO_OBRIGATORIO'; end if;
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  select coalesce(is_admin,false) into v_admin from profiles where user_id = auth.uid();
  if not v_admin and not exists (
      select 1 from compras_lideres_cc
       where codigo_centro_ctrl = v_req.codigo_centro_ctrl
         and lider_user_id = auth.uid() and ativo) then
    return 'FORA_DO_SEU_CC';
  end if;

  update compras_requisicoes
     set status='rejeitada', rejeitada_por_user_id=auth.uid(), rejeitada_em=now(),
         motivo_rejeicao=trim(p_motivo), updated_at=now()
   where id = p_req_id;
  return 'OK';
end;
$$;

-- 2.4 Persistir desfecho do envio pós-aprovação (o líder envia req de OUTRO usuário —
--     RLS/UPDATE legado provavelmente não cobre; esta RPC cobre, sem afrouxar RLS)
drop function if exists public.registrar_envio_requisicao(uuid, text, jsonb);
create function public.registrar_envio_requisicao(p_req_id uuid, p_numero_alvo text, p_erro jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_admin boolean;
  v_autorizado boolean;
begin
  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'aprovada' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  select coalesce(is_admin,false) into v_admin from profiles where user_id = auth.uid();
  v_autorizado := v_admin
    or v_req.requisitante_user_id = auth.uid()
    or exists (select 1 from compras_lideres_cc
                where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                  and lider_user_id = auth.uid() and ativo);
  if not v_autorizado then return 'NAO_AUTORIZADO'; end if;

  if p_numero_alvo is not null then
    update compras_requisicoes
       set numero_alvo = p_numero_alvo, status = 'sincronizada',
           erro_envio = null, updated_at = now()
     where id = p_req_id;
    return 'SINCRONIZADA';
  else
    update compras_requisicoes
       set erro_envio = coalesce(p_erro, '{"erro":"desconhecido"}'::jsonb), updated_at = now()
     where id = p_req_id;
    return 'ERRO_REGISTRADO';
  end if;
end;
$$;

grant execute on function public.submeter_requisicao(uuid) to authenticated;
grant execute on function public.aprovar_requisicao(uuid) to authenticated;
grant execute on function public.rejeitar_requisicao(uuid, text) to authenticated;
grant execute on function public.registrar_envio_requisicao(uuid, text, jsonb) to authenticated;
```

```sql
notify pgrst, 'reload schema';
```

> Nota: se o D8 revelar que o envio legado grava `numero_alvo`/status de um jeito específico
> (upsert com colunas extras), **espelhar** esse jeito na 2.4 antes de rodar — a RPC não pode
> gravar menos que o fluxo legado grava.

### 5.5 RLS de leitura para o líder (⚠️ zona de vazamento own/all — moldar pelo D4)

O líder precisa **ler** reqs de outros usuários (as pendentes dos CCs dele) + filhos (itens, classes, arquivos). Template — só rodar depois do D4, ajustando ao formato das policies existentes:

```sql
-- compras_requisicoes: líder lê reqs dos CCs mapeados (qualquer status — visão do CC dele)
create policy req_select_lider on public.compras_requisicoes
  for select to authenticated
  using (exists (select 1 from compras_lideres_cc m
                  where m.lider_user_id = auth.uid() and m.ativo
                    and m.codigo_centro_ctrl = compras_requisicoes.codigo_centro_ctrl));

-- filhos: mesma condição via join no pai (repetir para itens / classes / arquivos)
create policy req_itens_select_lider on public.compras_requisicoes_itens
  for select to authenticated
  using (exists (select 1 from compras_requisicoes r
                  join compras_lideres_cc m on m.codigo_centro_ctrl = r.codigo_centro_ctrl
                 where r.id = compras_requisicoes_itens.requisicao_id
                   and m.lider_user_id = auth.uid() and m.ativo));
```

Policies são **aditivas** (OR) — as existentes não mudam; nada é afrouxado para quem não é líder.

### 5.6 Seed do piloto (Financeiro)

```sql
-- Papel ao Pedro (hub_user_roles com auditoria embutida)
insert into hub_user_roles (user_id, role_id, atribuido_por, atribuido_em, motivo)
select p.user_id, r.id, p.user_id, now(), 'Seed piloto — líder do Financeiro'
from profiles p, hub_roles r
where p.email='pedro.scrignoli@pfbrazil.com' and r.codigo='lider_departamento'
  and not exists (select 1 from hub_user_roles ur
                   where ur.user_id=p.user_id and ur.role_id=r.id and ur.revogado_em is null);

-- Mapeamento CC(s) do Financeiro (completar a lista com o Pedro)
insert into compras_lideres_cc (lider_user_id, codigo_centro_ctrl)
select p.user_id, cc.codigo
from profiles p,
     (values ('00010.00002.00003')) as cc(codigo)   -- CONTROLADORIA/FINANCEIRO; adicionar outros CCs se houver
where p.email='pedro.scrignoli@pfbrazil.com'
on conflict (lider_user_id, codigo_centro_ctrl) do nothing;
```

### 5.7 Gate de saída da Fase 1

Re-rodar D1/D7: colunas novas visíveis; permissão e papel existem; papel `admin` tem a permissão nova; as 4 RPCs em `information_schema.routines`; `select aprovar_requisicao(gen_random_uuid());` → `NAO_ENCONTRADA` (ou `SEM_PERMISSAO` se rodado sem contexto de auth — ambos provam a função viva); mapeamento do piloto presente.

---

## 6. FASE 2 — Camada de serviço (Claude Code edita, git push→Lovable)

Condicionada ao D8/D11 (service real + rota real + persistência real).

### 6.1 Roteamento da submissão
No service de requisições, a ação final do wizard passa a: `rpc('submeter_requisicao', { p_req_id })` e roteia pelo retorno:
- `SEM_GATE` → executa o **envio legado** intacto (mesmo código de hoje, extraído/isolado como `enviarRequisicaoAlvo(reqId)` se ainda não for função separada).
- `AUTO_APROVADA` → executa `enviarRequisicaoAlvo(reqId)`; desfecho via `registrar_envio_requisicao` **ou** pela persistência legada (o que o D8 mostrar — não duplicar).
- `PENDENTE` → encerra com feedback "enviada para aprovação do líder".
- Erros (`SEM_CENTRO_CUSTO`, `SEM_PERMISSAO`, `STATUS_INVALIDO:*`, `NAO_AUTORIZADO`) → mensagem visível. Fallback nunca silencioso.

### 6.2 Envio pós-aprovação (sessão do líder)
Botão APROVAR: `rpc('aprovar_requisicao')` → `OK` → `enviarRequisicaoAlvo(reqId)` → desfecho via `rpc('registrar_envio_requisicao', {...})`:
- sucesso → `SINCRONIZADA` (numero_alvo gravado, erro limpo);
- falha → `ERRO_REGISTRADO` → UI "Aprovada — erro no envio" + detalhe expandível + **Reenviar** (repete envio sem nova aprovação; disponível para líder do CC, criador e admin).

⚠️ Falha nº 1 esperada: `Observacao > 255` por item (§28.3 do report do módulo) — agora estoura na tela do **líder** → reforça a FASE 4.

### 6.3 Guardas de sync (auditoria dos pontos D9/D10)
- Job 4: adicionar `rejeitada` ao conjunto terminal anti-rebaixamento.
- Job 1 / `sincronizarStatusRequisicao` / open-load: guarda explícita `numero_alvo is not null`.
- Filtros com negação (`neq`/`NOT IN`): reescrever como **listas positivas** (NULL + status novos passam batido em negações — armadilha §24).
- Fila das operadoras (D13): garantir filtro positivo `status = 'sincronizada'`.

**Gate de saída:** `bun run build` limpo; grep prova que nenhum caminho de UI envia req ao Alvo sem passar por `submeter_requisicao`; push → editor Lovable → **Publicar**.

---

## 7. FASE 3 — Frontend

### 7.1 Wizard / criador
- Botão final: **"Enviar"** com roteamento transparente (mensagens por rota, §6.1).
- **"Salvar rascunho"** (se D11 mostrar que não existe): persiste sem submeter; lista "Minhas requisições" exibe rascunhos (escopo `view_own`).
- Req `rejeitada` no detalhe: **motivo + quem + quando** em destaque.

### 7.2 Fila do líder
- Rota nova (plugar conforme D12), ex. `/suprimentos/requisicoes/aprovacoes`; menu gateado por `compras.requisicoes.aprovar` via `get_user_permissions`.
- Query: `status='pendente_aprovacao'` + `codigo_centro_ctrl` ∈ CCs mapeados do usuário (admin: todos). Paginação `.range()` (max-rows=1000).
- Detalhe: **reusar** o componente de detalhe existente (itens, classes, valores, anexos).
- Ações: **APROVAR** (primária) | **REJEITAR** (destrutiva → modal, motivo obrigatório ≥5 chars, contador).
- Pós-APROVAR: feedback em 2 tempos — "Aprovada ✓" → "Enviando ao Alvo…" → "Sincronizada (nº X)" | "Erro no envio" + Reenviar.

### 7.3 Clonar para Nova Requisição (toda req, qualquer status)
- Botão no detalhe; permission `compras.requisicoes.create`.
- Copia: cabeçalho (funcionário, CC, finalidade, data de necessidade) + itens + classes/rateio. **Anexos ficam de fora no v1.**
- Resultado: novo `rascunho` do usuário atual, abre no wizard para revisão.

### 7.4 Badges e filtros
- Novos estados: `Pendente aprovação` (âmbar/neutro) · `Aprovada — enviando` · `Aprovada — erro no envio` (cor forte, exceção) · `Rejeitada`.
- Direção visual do redesign: institucional/sóbrio, cor forte só para exceção, `tabular-nums` em valores.
- Atualizar todo dropdown/filtro de status apontado pelo D9.

**Gate de saída:** roteiro manual com **usuário sem is_admin** (regra 13 de engajamento); push → editor → **Publicar**.

---

## 8. FASE 4 — Validação de 255 chars na digitação (dívida §28.3, agora crítica)

Contador + bloqueio na observação **por item** do wizard (limite do Alvo = 255). Evita que o erro clássico estoure na tela do líder no pós-aprovação. Entrega isolada, prompt próprio.

---

## 9. FASE 5 — Validação fim-a-fim (piloto Financeiro)

Pré-condição: seed rodado; **um requisitante-cobaia sem `is_admin` e sem papel de líder** (a definir com o Pedro).

1. Cobaia cria req com CC **fora** do piloto → `SEM_GATE` → envio direto ao Alvo (fluxo legado intacto).
2. Cobaia cria req com CC `00010.00002.00003` → `PENDENTE`; operadoras **não** veem; req **não existe** no Alvo.
3. Pedro (líder) vê na fila, abre detalhe completo (itens/classes/anexos legíveis — prova das policies §5.5).
4. **Rejeição:** motivo → `rejeitada`; cobaia vê motivo; Job 4 no próximo ciclo não ressuscita; "Clonar" gera rascunho novo.
5. **Aprovação:** nova req → APROVAR → envio → `numero_alvo` + `sincronizada` → operadora enxerga → vira pedido normal (clonar → enviarPedido → baixa).
6. **Auto-aprovação:** Pedro cria req no CC dele → `AUTO_APROVADA` (registrada: aprovada_por=Pedro, aprovacao_automatica=true) → Alvo direto.
7. **Erro:** req com observação de item >255 → aprovar → falha → `aprovada`+`erro_envio` visível → corrigir → Reenviar → `sincronizada`.
8. **Sync neutro:** ciclo do cron não altera nenhuma `pendente_aprovacao`/`rejeitada`.
9. **Permissões:** cobaia NÃO vê a fila de aprovações nem consegue chamar `aprovar_requisicao` (retorno `SEM_PERMISSAO`).

---

## 10. Fora de escopo (registrado)

- **E-mails/notificações de pendência ou decisão** — decisão gerencial (resposta 13). Se um dia entrar: padrão estado+scan do §22 do report do módulo, com log de dedup e CRON_SECRET.
- Escalation/substituto automático de líder ausente (mitigado: 2º líder no mesmo CC via `compras_lideres_cc`, ou decisão do admin).
- Gate para requisições nativas do Alvo / trava na conversão em pedido.
- Alçadas por valor.
- Cópia de anexos no Clonar.
- Tabela de eventos de auditoria (trilha = colunas, decisão 12).

## 11. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| D8: rota de envio de req desconhecida (req-comp.ts não inspecionado) | Fase 0 etapa 1 (grep no front); etapa 2: Pedro traz req-comp.ts/alvo.ts/index.ts do GitHub Web; adendo ao report do proxy |
| Persistência legada do envio ≠ RPC 2.4 | D8 documenta o que o legado grava; 2.4 espelha antes de rodar |
| RLS: líder sem leitura dos filhos da req (detalhe quebra) | D4 completo (pai+filhos, SELECT/UPDATE) antes das policies §5.5; teste com usuário não-admin |
| Vazamento own/all (zona sensível de Suprimentos) | Policies novas 100% aditivas e escopadas ao mapeamento; D13 confirma fila das operadoras |
| CC editável no wizard muda o aprovador (ou sai do gate no piloto) | Consciente: aprovação segue o CC onerado. Futuro possível: log de alteração de CC ou trava por papel |
| Pedro é o único is_admin → bypass esconde erros | Toda validação com usuário sem is_admin (Fase 5 exige cobaia) |
| Status novos × filtros negados (`NOT IN`/`neq`+NULL) | D9 mapeia todos; reescrever como listas positivas |
| Req presa se líder ausente | Admin decide (bypass) ou 2º líder mapeado no CC |

## 12. Prompts desta missão (imutáveis após criados)

| Prompt | Conteúdo | Executor |
|---|---|---|
| **PROMPT 0** | Fase 0 → `DISCOVERY-APROVACAO-REQ.md` + adendo `relatorio-erp-proxy.md` | Claude Code (read-only) |
| **PROMPT 1** | Fase 1: RBAC + `compras_lideres_cc` + colunas + 4 RPCs + RLS + seed piloto | Claude escreve, Pedro executa |
| **PROMPT 2** | Fase 2: roteamento da submissão, envio pós-aprovação, guardas de sync | Claude Code + push |
| **PROMPT 3** | Fase 3: wizard/rascunho, fila do líder, clonar, badges/filtros | Claude Code + push + Publicar |
| **PROMPT 4** | Fase 4: validação 255 chars por item na digitação | Claude Code + push |
| **PROMPT 5** | Fase 5: roteiro de validação fim-a-fim do piloto | Pedro + cobaia |

> Ajustes posteriores = **novo prompt** (Ajuste N.x), original intocado.

## 13. Insumos pendentes do Pedro (não bloqueiam o PROMPT 0)

1. **Lista de CCs do Financeiro** para o seed (mínimo confirmado: `00010.00002.00003` CONTROLADORIA/FINANCEIRO).
2. **Cobaia do piloto** — um usuário `requisitante` sem is_admin (Fase 5).
3. Se a Fase 0 pedir: arquivos `req-comp.ts`, `alvo.ts`, `index.ts` do erp-proxy (GitHub Web).
4. Veto rápido, se discordar: interpretei "só as tabelas" (resposta 12) como **colunas na própria requisição, sem tabela de eventos**.

---

*Fim do guia v2. Gate de aprovação por líder de departamento, roteado pelo centro de custo da requisição, integrado ao RBAC do Hub, com rollout progressivo via mapeamento (piloto: Financeiro). Sem e-mails. Antes de codar: Fase 0. Antes de tudo: `git pull`.*
