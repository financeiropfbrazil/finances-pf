# SQL-FASE1-CONSOLIDADO.md — Fase 1 em 12 execuções
## Mesmo conteúdo de SQL-FASE1-APROVACAO.md (B1–B28), reagrupado para colagem

> **Origem:** `SQL-FASE1-APROVACAO.md` (commit 51117c7), já revisado. **Nenhum SQL novo.**
> **Regra do reagrupamento:** statements simples podem viver juntos num Run; **toda função com
> corpo `$$` vai SOZINHA** (mistura de corpo dollar-quoted com outros statements é a causa
> provável dos lotes que retornaram "Success" sem gravar em 07/08).
> **Executor:** Pedro, SQL Editor, projeto `hbtggrbauguukewiknew` (fingerprint conferido: `compras_pedidos`=1819).

### Como executar (leia antes)

1. Uma aba do SQL Editor. Para cada execução: **apagar tudo → colar → conferir que NADA está selecionado → Run**.
2. **Nada selecionado** é crítico: com texto selecionado, o Editor roda só a seleção e devolve "Success" enganoso.
3. Execute **E1 … E12 na ordem**. Não pule, não junte.
4. Erro em qualquer execução → **PARE** e reporte (texto literal + número da execução). Exceção única: em **E3**, `policy "lideres_cc_select" already exists` → siga para E4.
5. Tudo é idempotente: reexecutar não duplica.

---

## E1 — RBAC (permissão, papel, mapeamentos) · era B1–B4

```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.requisicoes.aprovar', 'Aprovar Requisições',
       'Aprovar/rejeitar requisições pendentes dos centros de custo sob sua liderança', 'compras'
where not exists (select 1 from hub_permissions where codigo='compras.requisicoes.aprovar');

insert into hub_roles (codigo, nome, descricao, modulo, is_system)
select 'lider_departamento', 'Líder de Departamento',
       'Aprova requisições de compra dos centros de custo que lidera', 'compras', false
where not exists (select 1 from hub_roles where codigo='lider_departamento');

insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='lider_departamento'
  and p.codigo in ('compras.requisicoes.access','compras.requisicoes.aprovar')
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo='admin' and p.codigo='compras.requisicoes.aprovar'
  and not exists (select 1 from hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```
**Esperado:** `Success. No rows returned` (parte já existe desde 06/08 — idempotente).

---

## E2 — Tabela do mapeamento + RLS + colunas de decisão · era B5, B6, B8

```sql
create table if not exists public.compras_lideres_cc (
  id uuid primary key default gen_random_uuid(),
  lider_user_id uuid not null,
  codigo_centro_ctrl text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (lider_user_id, codigo_centro_ctrl)
);

alter table public.compras_lideres_cc enable row level security;

alter table public.compras_requisicoes
  add column if not exists aprovada_por_user_id uuid,
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovacao_automatica boolean not null default false,
  add column if not exists rejeitada_por_user_id uuid,
  add column if not exists rejeitada_em timestamptz,
  add column if not exists motivo_rejeicao text;
```
**Esperado:** `Success. No rows returned`.

---

## E3 — Policy de leitura · era B7

```sql
create policy lideres_cc_select on public.compras_lideres_cc
  for select to authenticated using (true);
```
**Esperado:** `Success`. Se disser `already exists` → siga para E4.

---

## ✅ CHECKPOINT 1 — rode isto antes de continuar

```sql
select to_regclass('public.compras_lideres_cc') is not null as tabela,
       (select count(*) from pg_policies where tablename='compras_lideres_cc') as policies,
       (select count(*) from information_schema.columns
         where table_schema='public' and table_name='compras_requisicoes'
           and column_name in ('aprovada_por_user_id','aprovada_em','aprovacao_automatica',
                               'rejeitada_por_user_id','rejeitada_em','motivo_rejeicao')) as colunas_de_6;
```
**Esperado: `true | 1 | 6`.** Diferente disso → **PARE** e reporte. (Foi exatamente aqui que o dia 07/08 falhou em silêncio.)

---

## E4 — Helper de auditoria `_req_evento` · era B10–B11 (função: sozinha)

```sql
drop function if exists public._req_evento(uuid, text, jsonb);
```
**Rode só isso. Esperado:** `Success`.

---

## E5 — Cria `_req_evento` · era B11

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
  raise warning '_req_evento falhou para % (%): %', p_req_id, p_evento, sqlerrm;
end;
$$;
```

---

## E6 — R1 `submeter_requisicao` · era B12–B13

```sql
drop function if exists public.submeter_requisicao(uuid);
```
Rode, depois **apague e cole a criação abaixo, num Run separado**:

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
    return 'SEM_GATE';
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

---

## E7 — R2 `aprovar_requisicao` · era B14–B15

```sql
drop function if exists public.aprovar_requisicao(uuid);
```
Depois, Run separado:

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

---

## E8 — R3 `rejeitar_requisicao` · era B16–B17

```sql
drop function if exists public.rejeitar_requisicao(uuid, text);
```
Depois, Run separado:

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

---

## E9 — R4 `registrar_envio_requisicao` · era B18–B20

```sql
drop function if exists public.registrar_envio_requisicao(uuid, text, jsonb);
drop function if exists public.registrar_envio_requisicao(uuid, text, text);
```
Depois, Run separado:

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

  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
  v_autorizado := v_admin
    or coalesce(v_req.requisitante_user_id = auth.uid(), false)
    or exists (select 1 from compras_lideres_cc
                where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                  and lider_user_id = auth.uid() and ativo);
  if not v_autorizado then return 'NAO_AUTORIZADO'; end if;

  if p_numero_alvo is not null then
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

---

## ✅ CHECKPOINT 2 — as 5 funções existem?

```sql
select count(*) as funcoes_de_5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('_req_evento','submeter_requisicao',
      'aprovar_requisicao','rejeitar_requisicao','registrar_envio_requisicao');
```
**Esperado: `5`.** Diferente → **PARE** e reporte.

---

## E10 — Função do trigger · era B23 (sozinha)

```sql
create or replace function public.fn_req_protege_aprovacao()
returns trigger
language plpgsql
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
      if old.status = any(protegidos)
         or new.status = any(protegidos)
         or new.aprovada_por_user_id  is distinct from old.aprovada_por_user_id
         or new.aprovada_em           is distinct from old.aprovada_em
         or new.aprovacao_automatica  is distinct from old.aprovacao_automatica
         or new.rejeitada_por_user_id is distinct from old.rejeitada_por_user_id
         or new.rejeitada_em          is distinct from old.rejeitada_em
         or new.motivo_rejeicao       is distinct from old.motivo_rejeicao then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovação (update)';
      end if;
      return new;
    else
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

---

## E11 — Trigger + grants + seed · era B21, B24–B27

```sql
grant execute on function public.submeter_requisicao(uuid) to authenticated;
grant execute on function public.aprovar_requisicao(uuid) to authenticated;
grant execute on function public.rejeitar_requisicao(uuid, text) to authenticated;
grant execute on function public.registrar_envio_requisicao(uuid, text, text) to authenticated;

drop trigger if exists trg_req_protege_aprovacao on public.compras_requisicoes;

create trigger trg_req_protege_aprovacao
  before insert or update or delete on public.compras_requisicoes
  for each row execute function public.fn_req_protege_aprovacao();

insert into hub_user_roles (user_id, role_id, atribuido_por, atribuido_em, motivo)
select p.user_id, r.id, p.user_id, now(), 'Seed piloto — líder do Financeiro'
from profiles p, hub_roles r
where p.email='pedro.scrignoli@pfbrazil.com' and r.codigo='lider_departamento'
  and not exists (select 1 from hub_user_roles ur
                   where ur.user_id=p.user_id and ur.role_id=r.id and ur.revogado_em is null);

insert into compras_lideres_cc (lider_user_id, codigo_centro_ctrl)
select p.user_id, '00010.00002.00003'
from profiles p
where p.email='pedro.scrignoli@pfbrazil.com'
on conflict (lider_user_id, codigo_centro_ctrl) do nothing;
```

---

## E12 — Recarga do PostgREST · era B28 (deve ser o ÚLTIMO comando)

```sql
notify pgrst, 'reload schema';
```

---

## GATE FINAL — 5 execuções

**G-A — colunas, tabela, RLS, policy** (esperado: `6 | true | true | 1`)
```sql
select (select count(*) from information_schema.columns
         where table_schema='public' and table_name='compras_requisicoes'
           and column_name in ('aprovada_por_user_id','aprovada_em','aprovacao_automatica',
                               'rejeitada_por_user_id','rejeitada_em','motivo_rejeicao')) as colunas_de_6,
       to_regclass('public.compras_lideres_cc') is not null as tabela,
       (select relrowsecurity from pg_class where oid='public.compras_lideres_cc'::regclass) as rls_ligada,
       (select count(*) from pg_policies where tablename='compras_lideres_cc') as policies;
```

**G-B — funções e trigger** (esperado: 6 linhas; `fn_req_protege_aprovacao` com `security_definer=false`, as outras 5 `true`)
```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('_req_evento','submeter_requisicao','aprovar_requisicao',
                    'rejeitar_requisicao','registrar_envio_requisicao','fn_req_protege_aprovacao')
order by p.proname;
```

**G-C — trigger instalado + RPC viva** (esperado: `trg_req_protege_aprovacao | O` e `SEM_PERMISSAO`)
```sql
select tgname, tgenabled from pg_trigger
where tgrelid='public.compras_requisicoes'::regclass and not tgisinternal order by tgname;
```
```sql
select public.aprovar_requisicao(gen_random_uuid()) as deve_dar_sem_permissao;
```

**G-D — RBAC e seed** (esperado: 2 papéis com a permissão · 1 linha de mapeamento · 1 papel atribuído)
```sql
select (select count(*) from hub_role_permissions rp
          join hub_permissions p on p.id=rp.permission_id
         where p.codigo='compras.requisicoes.aprovar') as papeis_com_permissao,
       (select count(*) from compras_lideres_cc) as seed_cc,
       (select count(*) from hub_user_roles ur join hub_roles r on r.id=ur.role_id
         where r.codigo='lider_departamento' and ur.revogado_em is null) as papel_atribuido;
```

**G-E — nada foi alterado nos dados existentes** (esperado: os mesmos status de sempre, nenhum `pendente_aprovacao`/`aprovada`/`rejeitada`)
```sql
select status, count(*) from compras_requisicoes group by 1 order by 2 desc;
```

---

## Depois do gate verde

1. Linha no `ESTADO-APROVACAO-REQ.md`: *"Fase 1 executada em 07/08/2026 via SQL-FASE1-CONSOLIDADO (E1–E12), gate verde."*
2. `git add` explícito dos .md → commit → `git pull --no-edit` → `git push` (leva junto os 3 commits pendentes).
3. **PROMPT 2** (Fase 2 — código), com a saída de G-B/G-C/G-D colada no rodapé como evidência.
