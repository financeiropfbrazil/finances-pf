# SQL-FASE1-APROVACAO.md — Fase 1 pronta para o SQL Editor (PROMPT 1)

> Missão **Aprovação de Requisições pelo Líder de Departamento**.
> Fonte: `AJUSTE-1.1-APROVACAO-REQ.md` §2 (manda sobre o guia v2), ajustado pelos pré-voos **D14/D14b** desta sessão e pelo **D8** do `DISCOVERY-APROVACAO-REQ.md`.
> Gerado em **06/08/2026** · Projeto `hbtggrbauguukewiknew` · Executor: **Pedro, no SQL Editor**. O Claude Code **não executou nada** — o MCP está `read_only=true`.

## Como executar

1. Rode o **§0 (pré-voo de lock)** imediatamente antes de começar.
2. Execute os blocos **B1 … B23 na ordem**, **um bloco por vez**. Cada bloco é **um único statement** (o SQL Editor abandona `BEGIN/COMMIT` em silêncio — por isso nada de transação manual).
3. Se um bloco falhar, **pare** e me mande o erro — não pule para o próximo.
4. Ao final, rode o **§3 (gate de saída)**. O §4 tem o rollback completo, na ordem correta.

Todos os blocos são **idempotentes** (`if not exists` / `if not exists` / `create or replace` / `on conflict do nothing`) — reexecutar não duplica nada.

---

## 0. Pré-voo (read-only) — resultados desta sessão + ritual de lock

Já verificado agora, via MCP:

| Check | Resultado |
|---|---|
| **D14** — colunas de `compras_requisicoes_auditoria` | `id, requisicao_id (NN), evento (NN), user_id, user_nome, payload_enviado (jsonb), resposta_alvo (jsonb), sucesso (bool), mensagem_erro (text), created_at (NN, default now())` — **não existe coluna `detalhe`** |
| **D14b** — vocabulário de eventos | `envio_tentado` 183 · `criada` 168 · `envio_sucesso` 168 · `convertida_pedido` **152** · `cancelada_alvo` 25 · `envio_falha` 19 · `desvinculado_pedido` 3 · `vinculado_pedido` 2 |
| Transações velhas (>2 min) | **nenhuma** ✅ |
| Objetos novos já existentes? | `compras_lideres_cc` 0 · permissão 0 · papel 0 · as 6 funções 0 → **tudo nasce limpo** |
| Owner das RPCs existentes | `postgres` → dentro de `SECURITY DEFINER`, `current_user='postgres'` ⇒ **passa pelo trigger B23–B25** ✅ |
| GRANT default do schema | `postgres` concede `arwdDxtm` a `anon/authenticated/service_role` em tabelas novas ⇒ **`compras_lideres_cc` não precisa de GRANT explícito**; a RLS é quem controla ✅ |

**Ritual de lock — rode isto antes de começar (deve voltar vazio):**

```sql
select pid, usename, state, xact_start, left(query,80) q
from pg_stat_activity
where state <> 'idle' and xact_start < now() - interval '2 minutes';
```

---

## 1. Blocos de execução

### 1.1 RBAC — permissão e papel (Ajuste §2.1)

**B1 — permissão nova**
```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.requisicoes.aprovar', 'Aprovar Requisições',
       'Aprovar/rejeitar requisições pendentes dos centros de custo sob sua liderança', 'compras'
where not exists (select 1 from hub_permissions where codigo='compras.requisicoes.aprovar');
```

**B2 — papel Líder de Departamento**
```sql
insert into hub_roles (codigo, nome, descricao, modulo, is_system)
select 'lider_departamento', 'Líder de Departamento',
       'Aprova requisições de compra dos centros de custo que lidera', 'compras', false
where not exists (select 1 from hub_roles where codigo='lider_departamento');
```

**B3 — permissões do papel (access + aprovar)**
```sql
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='lider_departamento'
  and p.codigo in ('compras.requisicoes.access','compras.requisicoes.aprovar')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```

**B4 — ⚠️ lição §9.1 (13 órfãs): a permissão nova TAMBÉM no papel `admin`**
```sql
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='admin' and p.codigo='compras.requisicoes.aprovar'
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```

### 1.2 Mapeamento líder ↔ CC e colunas de decisão (Ajuste §2.2)

**B5 — tabela do mapeamento (a chave de rollout)**
```sql
create table if not exists public.compras_lideres_cc (
  id uuid primary key default gen_random_uuid(),
  lider_user_id uuid not null,            -- = profiles.user_id = auth.uid()
  codigo_centro_ctrl text not null,       -- formato confirmado no D3, ex. '00010.00002.00003'
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lider_user_id, codigo_centro_ctrl)
);
```

**B6 — RLS ligada**
```sql
alter table public.compras_lideres_cc enable row level security;
```

**B7 — policy de leitura (sem policies de escrita: gestão só via SQL Editor)**
```sql
create policy lideres_cc_select on public.compras_lideres_cc
  for select to authenticated using (true);
```
> Reexecutar B7 dá erro `policy already exists` — é esperado e inofensivo. Para reexecução limpa, rode antes `drop policy if exists lideres_cc_select on public.compras_lideres_cc;`.

**B8 — colunas de decisão na requisição (A2: sem `erro_envio jsonb`)**
```sql
alter table public.compras_requisicoes
  add column if not exists aprovada_por_user_id uuid,
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovacao_automatica boolean not null default false,
  add column if not exists rejeitada_por_user_id uuid,
  add column if not exists rejeitada_em timestamptz,
  add column if not exists motivo_rejeicao text;
```

**B9 — recarrega o schema do PostgREST**
```sql
notify pgrst, 'reload schema';
```

### 1.3 Helper de auditoria — **ajustado ao D14/D14b** (Ajuste §2.3)

**B10 — `_req_evento`**

Mudanças em relação ao shape presumido do Ajuste (justificativa completa no §2 deste arquivo):
`detalhe` → **`payload_enviado`** (a coluna `detalhe` não existe) · preenche **`user_nome`** (a timeline exibe) · preenche **`sucesso`** (a timeline pinta o círculo de **vermelho** quando `sucesso` é falsy/NULL) · deriva **`mensagem_erro`** de `p_detalhe->>'erro'` nos eventos de falha (a timeline mostra esse campo em vermelho).

```sql
drop function if exists public._req_evento(uuid, text, jsonb);
```

**B11 — cria o helper**
```sql
create function public._req_evento(
  p_req_id  uuid,
  p_evento  text,
  p_detalhe jsonb,
  p_sucesso boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  -- Colunas REAIS da compras_requisicoes_auditoria (D14):
  --   requisicao_id NN, evento NN, user_id, user_nome, payload_enviado jsonb,
  --   resposta_alvo jsonb, sucesso bool, mensagem_erro text, created_at NN default now()
  -- Não existe coluna 'detalhe' → o jsonb da decisão vai em payload_enviado
  -- (a timeline do detalhe NÃO renderiza esse campo; só evento, user_nome,
  --  created_at e mensagem_erro — SuprimentosRequisicaoDetalhe.tsx:646-667).
  select full_name into v_nome from profiles where user_id = auth.uid();

  insert into compras_requisicoes_auditoria
    (requisicao_id, evento, user_id, user_nome, payload_enviado, sucesso, mensagem_erro)
  values
    (p_req_id,
     p_evento,
     auth.uid(),
     coalesce(v_nome, 'Sistema'),
     p_detalhe,
     coalesce(p_sucesso, true),
     case when coalesce(p_sucesso, true) then null
          else left(coalesce(p_detalhe->>'erro', 'erro desconhecido'), 2000) end);
exception when others then
  -- auditoria nunca derruba a operação principal, mas GRITA no log (regra 9 do guia)
  raise warning '_req_evento falhou para % (%): %', p_req_id, p_evento, sqlerrm;
end;
$$;
```

### 1.4 RPCs (Ajuste §2.4)

Vocabulário de eventos alinhado ao D14b (particípio + complemento, snake_case):
`submetida_sem_gate` · `enviada_aprovacao` · `aprovada_lider` · `rejeitada_lider` · **`envio_pos_aprovacao_sucesso`** · **`envio_pos_aprovacao_falha`** (os dois últimos vinham como `_ok`/`_erro` no Ajuste — renomeados para casar com `envio_sucesso`/`envio_falha` que já existem).

**B12 — drop da R1**
```sql
drop function if exists public.submeter_requisicao(uuid);
```

**B13 — R1: submissão com roteamento**
```sql
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
  -- Guarda de sessão: sem auth.uid() (SQL Editor, anon) nada prossegue.
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'rascunho' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

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
    perform public._req_evento(p_req_id, 'submetida_sem_gate',
             jsonb_build_object('cc', v_req.codigo_centro_ctrl));
    return 'SEM_GATE';   -- CC fora do rollout → frontend segue o envio legado
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
    perform public._req_evento(p_req_id, 'aprovada_lider',
             jsonb_build_object('automatica', true, 'cc', v_req.codigo_centro_ctrl));
    return 'AUTO_APROVADA';
  end if;

  update compras_requisicoes
     set status='pendente_aprovacao', updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'enviada_aprovacao',
           jsonb_build_object('cc', v_req.codigo_centro_ctrl));
  return 'PENDENTE';
end;
$$;
```

**B14 — drop da R2**
```sql
drop function if exists public.aprovar_requisicao(uuid);
```

**B15 — R2: líder aprova**
```sql
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
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  -- subselect com coalesce: usuário sem linha em profiles deixaria v_admin NULL,
  -- e 'not NULL and true' = NULL faria o IF abaixo NÃO disparar (bypass do escopo de CC).
  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
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
  perform public._req_evento(p_req_id, 'aprovada_lider',
           jsonb_build_object('automatica', false, 'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$$;
```

**B16 — drop da R3**
```sql
drop function if exists public.rejeitar_requisicao(uuid, text);
```

**B17 — R3: líder rejeita (motivo obrigatório; terminal)**
```sql
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
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  if p_motivo is null or length(trim(p_motivo)) < 5 then return 'MOTIVO_OBRIGATORIO'; end if;
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
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
  perform public._req_evento(p_req_id, 'rejeitada_lider',
           jsonb_build_object('motivo', trim(p_motivo), 'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$$;
```

**B18 — drop da R4 (assinatura jsonb do guia v2)**
```sql
drop function if exists public.registrar_envio_requisicao(uuid, text, jsonb);
```

**B19 — drop da R4 (assinatura text)**
```sql
drop function if exists public.registrar_envio_requisicao(uuid, text, text);
```

**B20 — R4: desfecho do envio pós-aprovação (A2 + espelho do legado do D8)**

O D8 mostrou que o envio legado grava, **além** de `status`/`numero_alvo`:
`enviado_em` no sucesso (`requisicoesService.ts:409,641,854`), `erro_ultimo_envio` + `tentativa_envio_em` na falha (`:438-439, 681-682, 897-898`), e `erro_ultimo_envio = null` ao reenviar com sucesso (`:855`). Os demais campos do upsert legado (`codigo_empresa_filial`, `codigo_funcionario`, `codigo_centro_ctrl`, `codigo_finalidade_compra`, `data_necessidade`, `total_itens`, `requisitante_user_id`) são **repetição obrigatória do upsert**, não informação nova — um `UPDATE` não precisa reenviá-los. **Tudo o que o legado grava de fato está espelhado abaixo.**

```sql
create function public.registrar_envio_requisicao(p_req_id uuid, p_numero_alvo text, p_erro text)
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
  if auth.uid() is null then return 'NAO_AUTORIZADO'; end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'aprovada' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  -- coalesce em TODOS os termos: com v_admin NULL (usuário sem profile) o OR
  -- resultaria NULL, 'not NULL' não dispararia o IF e a função seguiria gravando.
  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
  v_autorizado := v_admin
    or coalesce(v_req.requisitante_user_id = auth.uid(), false)
    or exists (select 1 from compras_lideres_cc
                where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                  and lider_user_id = auth.uid() and ativo);
  if not v_autorizado then return 'NAO_AUTORIZADO'; end if;

  if p_numero_alvo is not null then
    -- espelha o sucesso do envio legado (D8): status + numero_alvo + enviado_em,
    -- e limpa o erro anterior como faz o reenvio legado.
    update compras_requisicoes
       set numero_alvo = p_numero_alvo,
           status = 'sincronizada',
           enviado_em = now(),
           erro_ultimo_envio = null,
           updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'envio_pos_aprovacao_sucesso',
             jsonb_build_object('numero_alvo', p_numero_alvo));
    return 'SINCRONIZADA';
  else
    -- espelha a falha do legado (erro_ultimo_envio + tentativa_envio_em), MAS
    -- mantém status='aprovada' de propósito: o legado rebaixa para 'rascunho',
    -- o que apagaria a decisão do líder (achado do discovery §9.2).
    update compras_requisicoes
       set erro_ultimo_envio = coalesce(p_erro, 'erro desconhecido'),
           tentativa_envio_em = now(),
           updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'envio_pos_aprovacao_falha',
             jsonb_build_object('erro', left(coalesce(p_erro,'?'), 500)), false);
    return 'ERRO_REGISTRADO';
  end if;
end;
$$;
```

**B21 — grants de execução**
```sql
grant execute on function public.submeter_requisicao(uuid) to authenticated;
grant execute on function public.aprovar_requisicao(uuid) to authenticated;
grant execute on function public.rejeitar_requisicao(uuid, text) to authenticated;
grant execute on function public.registrar_envio_requisicao(uuid, text, text) to authenticated;
```
> Único bloco com mais de um statement — são 4 `grant` independentes e idempotentes. Redundantes na prática (o default ACL do schema já concede EXECUTE a `authenticated`), mantidos por explicitude.

**B22 — recarrega o schema do PostgREST**
```sql
notify pgrst, 'reload schema';
```

### 1.5 Trigger de integridade (Ajuste §2.5 — A5)

Fecha **só** a superfície da aprovação contra escrita direta via API. RPCs (`SECURITY DEFINER`, owner `postgres`) e cron/Edge (`service_role`) passam; o fluxo legado nunca toca esses estados → passa intacto.

**B23 — função do trigger**
```sql
create or replace function public.fn_req_protege_aprovacao()
returns trigger
language plpgsql
-- SECURITY INVOKER (default) DE PROPÓSITO: current_user precisa refletir quem chama
as $$
declare
  protegidos constant text[] := array['pendente_aprovacao','aprovada','rejeitada'];
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status = any(protegidos)
         or new.aprovada_por_user_id is not null or new.aprovada_em is not null
         or new.rejeitada_por_user_id is not null or new.rejeitada_em is not null
         or new.motivo_rejeicao is not null
         or coalesce(new.aprovacao_automatica,false) then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovação (insert)';
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      if old.status = any(protegidos)            -- linha em estado protegido: intocável por API direta
         or new.status = any(protegidos)         -- entrar em estado protegido por fora
         or new.aprovada_por_user_id  is distinct from old.aprovada_por_user_id
         or new.aprovada_em           is distinct from old.aprovada_em
         or new.aprovacao_automatica  is distinct from old.aprovacao_automatica
         or new.rejeitada_por_user_id is distinct from old.rejeitada_por_user_id
         or new.rejeitada_em          is distinct from old.rejeitada_em
         or new.motivo_rejeicao       is distinct from old.motivo_rejeicao then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovação (update)';
      end if;
      return new;
    else  -- DELETE: rejeitada é registro de auditoria; pendente não se apaga por fora
      if old.status = any(protegidos) then
        raise exception 'PROTEGIDO_APROVACAO: registro do fluxo de aprovação não pode ser excluído via API';
      end if;
      return old;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
```

**B24 — remove trigger anterior (idempotência)**
```sql
drop trigger if exists trg_req_protege_aprovacao on public.compras_requisicoes;
```

**B25 — cria o trigger**
```sql
create trigger trg_req_protege_aprovacao
  before insert or update or delete on public.compras_requisicoes
  for each row execute function public.fn_req_protege_aprovacao();
```

> **Efeito colateral desejado:** o `reenviarRequisicao` legado (que rebaixa `aprovada`→`rascunho`) passa a ser **bloqueado no banco** se algum caminho de código escapar da correção da Fase 2 — defesa em profundidade.
>
> **Efeito colateral a ter em mente na Fase 3:** com o trigger ativo, o requisitante **não consegue cancelar nem excluir** a própria requisição enquanto ela estiver `pendente_aprovacao` (o `excluirRequisicao` faz `DELETE` direto). Se "desistir da requisição pendente" virar requisito, será uma RPC nova — não um afrouxamento do trigger.

### 1.6 Seed do piloto (Ajuste §2.6 — A1: só o CC do Financeiro)

**B26 — papel de líder para o Pedro**
```sql
insert into hub_user_roles (user_id, role_id, atribuido_por, atribuido_em, motivo)
select p.user_id, r.id, p.user_id, now(), 'Seed piloto — líder do Financeiro'
from profiles p, hub_roles r
where p.email='pedro.scrignoli@pfbrazil.com' and r.codigo='lider_departamento'
  and not exists (select 1 from hub_user_roles ur
                   where ur.user_id=p.user_id and ur.role_id=r.id and ur.revogado_em is null);
```

**B27 — mapeamento Pedro × `00010.00002.00003` (Controladoria/Financeiro)**
```sql
insert into compras_lideres_cc (lider_user_id, codigo_centro_ctrl)
select p.user_id, '00010.00002.00003'
from profiles p
where p.email='pedro.scrignoli@pfbrazil.com'
on conflict (lider_user_id, codigo_centro_ctrl) do nothing;
```

**B28 — recarga final do PostgREST**
```sql
notify pgrst, 'reload schema';
```

---

## 2. O que mudou em relação ao Ajuste §2 (e por quê)

| # | Onde | Ajuste original | Aqui | Motivo |
|---|---|---|---|---|
| 1 | Helper `_req_evento` | `insert … (requisicao_id, evento, detalhe, user_id)` | `(requisicao_id, evento, user_id, user_nome, payload_enviado, sucesso, mensagem_erro)` | **D14: a coluna `detalhe` não existe.** O jsonb vai em `payload_enviado` — a coluna "de entrada" do evento. A timeline não renderiza esse campo (`SuprimentosRequisicaoDetalhe.tsx:646-667`), então não polui a UI |
| 2 | Helper — assinatura | 3 args | 4 args, `p_sucesso boolean default true` | **Surpresa do D14:** a timeline pinta o círculo do evento com `evt.sucesso ? verde : vermelho` (`:653`). Com `sucesso` NULL (falsy), **toda aprovação apareceria como erro em vermelho**. As chamadas de 3 args continuam válidas pelo default |
| 3 | Helper — `user_nome` | não preenchido | `full_name` do profile, fallback `'Sistema'` | A timeline exibe `evt.user_nome \|\| "Sistema"` (`:664`) e o padrão do service já grava o nome |
| 4 | Helper — `mensagem_erro` | não preenchido | derivado de `p_detalhe->>'erro'` quando `p_sucesso=false` | A timeline mostra `mensagem_erro` em vermelho (`:666`) — é onde o líder vê o motivo da falha de envio |
| 5 | Nome de 2 eventos | `envio_pos_aprovacao_ok` / `_erro` | `envio_pos_aprovacao_sucesso` / `_falha` | **D14b:** o vocabulário vivo usa `envio_sucesso`/`envio_falha`. O label da timeline é derivado do próprio nome do evento |
| 6 | **R4 — sucesso** | grava `numero_alvo`, `status`, `erro_ultimo_envio=null` | **+ `enviado_em = now()`** | **Marcador do Ajuste cumprido (D8):** o legado grava `enviado_em` em todo sucesso (`requisicoesService.ts:409,641,854`). Sem isso a RPC gravaria menos que o legado |
| 7 | **R4 — falha** | grava só `erro_ultimo_envio` | **+ `tentativa_envio_em = now()`** | Idem: o legado grava os dois juntos (`:438-439, 681-682, 897-898`) |
| 8 | R1–R4 | sem guarda de sessão | `if auth.uid() is null then return 'SEM_PERMISSAO'` (R4: `'NAO_AUTORIZADO'`) | O default ACL do schema concede EXECUTE a **`anon`** também. Reusa códigos de retorno já previstos — **não amplia o contrato** que a Fase 2 vai tratar |
| 9 | **R2, R3, R4 — `v_admin`** | `select coalesce(is_admin,false) into v_admin from profiles where user_id=auth.uid()` | `v_admin := coalesce((select is_admin from profiles where user_id=auth.uid()), false)` | **Correção de bug real:** `SELECT INTO` sem linha deixa a variável **NULL** (o `coalesce` interno nunca roda). Em R2/R3, `not NULL and true` = NULL ⇒ o `return 'FORA_DO_SEU_CC'` **não dispara** e a aprovação passa fora do CC. Em R4, `NULL or NULL or false` = NULL ⇒ `not NULL` não dispara e o **UPDATE executa sem autorização**. O subselect com `coalesce` externo é NULL-safe por construção |
| 10 | R4 — `v_autorizado` | `or v_req.requisitante_user_id = auth.uid()` | `or coalesce(v_req.requisitante_user_id = auth.uid(), false)` | `requisitante_user_id` é nullable (D1) — comparação com NULL devolve NULL e contamina o OR |

**Não mudou:** B1–B9 (RBAC, tabela, colunas), o corpo lógico das R1–R3, o trigger §2.5 inteiro, o seed §2.6 e as decisões A1–A7.

---

## 3. Gate de saída da Fase 1 (§2.7 do Ajuste) — rodar depois de B28

**G1 — as 6 colunas novas existem** (esperado: 6 linhas)
```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='compras_requisicoes'
  and column_name in ('aprovada_por_user_id','aprovada_em','aprovacao_automatica',
                      'rejeitada_por_user_id','rejeitada_em','motivo_rejeicao')
order by column_name;
```

**G2 — tabela do mapeamento, RLS ligada e 1 policy** (esperado: `compras_lideres_cc | true | 1`)
```sql
select to_regclass('public.compras_lideres_cc')::text as tabela,
       (select relrowsecurity from pg_class where oid='public.compras_lideres_cc'::regclass) as rls_ligada,
       (select count(*) from pg_policies where tablename='compras_lideres_cc') as policies;
```

**G3 — permissão mapeada a `lider_departamento` E a `admin`** (esperado: 2 linhas)
```sql
select r.codigo as papel, p.codigo as permissao
from hub_role_permissions rp
join hub_roles r on r.id = rp.role_id
join hub_permissions p on p.id = rp.permission_id
where p.codigo = 'compras.requisicoes.aprovar'
order by r.codigo;
```

**G4 — checklist das órfãs §9.1: `compras.requisicoes.aprovar` NÃO pode aparecer**
```sql
select p.codigo from hub_permissions p
where not exists (select 1 from hub_role_permissions rp where rp.permission_id = p.id)
order by p.codigo;
```

**G5 — helper + 4 RPCs + função do trigger vivas** (esperado: 6 linhas, todas `prosecdef=true` exceto `fn_req_protege_aprovacao`, que é **false de propósito**)
```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('_req_evento','submeter_requisicao','aprovar_requisicao',
                    'rejeitar_requisicao','registrar_envio_requisicao','fn_req_protege_aprovacao')
order by p.proname;
```

**G6 — prova de função viva** (esperado: `SEM_PERMISSAO` — o SQL Editor não tem `auth.uid()`)
```sql
select public.aprovar_requisicao(gen_random_uuid()) as deve_dar_sem_permissao;
```

**G7 — trigger instalado e habilitado** (esperado: `trg_req_protege_aprovacao | O`, ao lado do `trg_compras_requisicoes_updated_at`)
```sql
select tgname, tgenabled from pg_trigger
where tgrelid = 'public.compras_requisicoes'::regclass and not tgisinternal
order by tgname;
```

**G8 — trigger não atrapalha quem é `postgres`** (esperado: `UPDATE 0`, sem erro)
```sql
update compras_requisicoes set motivo_rejeicao = 'x' where false;
```
> A prova real do **bloqueio** é a Fase 5 item 9: a cobaia, via API com JWT próprio, tem que receber `PROTEGIDO_APROVACAO`.

**G9 — seed do piloto** (esperado: 1 linha, `pedro.scrignoli@pfbrazil.com | 00010.00002.00003 | true`)
```sql
select p.email, m.codigo_centro_ctrl, m.ativo
from compras_lideres_cc m join profiles p on p.user_id = m.lider_user_id;
```

**G10 — papel atribuído ao Pedro** (esperado: 1 linha)
```sql
select p.email, r.codigo as papel, ur.atribuido_em, ur.motivo
from hub_user_roles ur
join profiles p on p.user_id = ur.user_id
join hub_roles r on r.id = ur.role_id
where r.codigo = 'lider_departamento' and ur.revogado_em is null;
```

**G11 — nada foi alterado nos dados existentes** (esperado: os mesmos 4 status de sempre, nenhum `pendente_aprovacao`/`aprovada`/`rejeitada`)
```sql
select status, count(*) from compras_requisicoes group by 1 order by 2 desc;
```

**G12 — `notify pgrst, 'reload schema';` foi o último comando rodado** (B28). Se rodou algo depois, repita.

---

## 4. Rollback (ordem obrigatória — o trigger sai primeiro)

```sql
drop trigger if exists trg_req_protege_aprovacao on public.compras_requisicoes;
```
```sql
drop function if exists public.fn_req_protege_aprovacao();
```
```sql
drop function if exists public.registrar_envio_requisicao(uuid, text, text);
```
```sql
drop function if exists public.rejeitar_requisicao(uuid, text);
```
```sql
drop function if exists public.aprovar_requisicao(uuid);
```
```sql
drop function if exists public.submeter_requisicao(uuid);
```
```sql
drop function if exists public._req_evento(uuid, text, jsonb, boolean);
```
```sql
delete from compras_lideres_cc
where lider_user_id = (select user_id from profiles where email='pedro.scrignoli@pfbrazil.com');
```
```sql
update hub_user_roles set revogado_em = now(),
       revogado_por = (select user_id from profiles where email='pedro.scrignoli@pfbrazil.com'),
       motivo = coalesce(motivo,'') || ' | rollback Fase 1'
where role_id = (select id from hub_roles where codigo='lider_departamento')
  and revogado_em is null;
```
```sql
drop table if exists public.compras_lideres_cc;
```
```sql
delete from hub_role_permissions
where permission_id = (select id from hub_permissions where codigo='compras.requisicoes.aprovar');
```
```sql
delete from hub_permissions where codigo='compras.requisicoes.aprovar';
```
```sql
delete from hub_role_permissions where role_id = (select id from hub_roles where codigo='lider_departamento');
```
```sql
delete from hub_roles where codigo='lider_departamento';
```
```sql
notify pgrst, 'reload schema';
```

**As 6 colunas de B8 NÃO entram no rollback**: são aditivas, `null`/`false` em 100% das linhas e não afetam nenhum fluxo legado. Dropá-las só se houver motivo explícito — e aí uma a uma, com `alter table … drop column if exists`.

---

## 5. Depois deste SQL

1. Pedro roda B1→B28 e o gate §3.
2. Com o gate verde, o **PROMPT 2** (Fase 2 — código) começa pelo split `criarRequisicao()` + `enviarRequisicaoAlvo(id)` (Ajuste §3.1) — sem isso, `submeter_requisicao` não tem `p_req_id` para receber.
3. Pendência do Ajuste §8: definir a **cobaia** (`requisitante` sem `is_admin`, sem papel de líder) para a Fase 5.
