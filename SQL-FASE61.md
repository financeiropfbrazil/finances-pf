# SQL-FASE61.md — Fase 6.1: Mapa de Líderes por Centro de Custo

> **O Pedro executa.** O agente **não executou nada** — o MCP está `read_only=true`.
> Base: `AJUSTE-6.1-POS-DISCOVERY.md` §3 (manda) + `DISCOVERY-FASE6.md` (medições).
> Projeto: `hbtggrbauguukewiknew`. Fingerprint conferido antes de escrever: `compras_pedidos = 1820`,
> `compras_requisicoes = 309`, `compras_lideres_cc = 1`.

## Como executar

- **Um bloco por Run**, na ordem. Cada bloco é **um único statement**.
- ⚠️ **Todo `CREATE FUNCTION` usa tag nomeada** (`$a1$`, `$r1$`, `$l1$`) — o SQL Editor do Supabase
  corrompe corpos `$$` anônimos **em silêncio** (armadilha registrada no `ESTADO-APROVACAO-REQ.md` §2).
- Se um bloco der erro, **pare** e me chame — não pule para o seguinte.
- Rollback completo no §3.

**Pré-voo (rode antes do Bloco 1, confere o projeto e o estado de partida):**

```sql
select current_database() as db,
       (select count(*) from public.compras_pedidos)      as compras_pedidos,
       (select count(*) from public.compras_requisicoes)  as compras_requisicoes,
       (select count(*) from public.compras_lideres_cc)   as lideres_cc,
       (select count(*) from public.cost_centers where is_active and group_type='F') as universo_cc,
       (select count(*) from public.compras_requisicoes where status='pendente_aprovacao') as pendentes;
```
**Esperado:** `postgres` · `1820` · `309` · `1` · **`81`** · **`0`**
(`universo_cc = 81` é a decisão P1; `pendentes = 0` é o baseline do P5 — anote, será conferido de novo no gate.)

---

# 1. Blocos

## Bloco 1 — Colunas de auditoria (§3.1)

```sql
alter table public.compras_lideres_cc
  add column if not exists atribuido_por uuid,
  add column if not exists atribuido_em  timestamptz,
  add column if not exists revogado_por  uuid,
  add column if not exists revogado_em   timestamptz,
  add column if not exists motivo        text;
```

**Esperado:** `Success. No rows returned.`
**Confere:** a tabela passa de 5 para **10 colunas**. Todas nuláveis (correção §2.7 do Ajuste: as
linhas existentes não têm valor, então `atribuido_em` **não** nasce NOT NULL como em `hub_user_roles`).

---

## Bloco 2 — Backfill da linha do piloto (§3.1)

```sql
update public.compras_lideres_cc
   set atribuido_em = coalesce(atribuido_em, created_at),
       motivo       = coalesce(motivo, 'Seed piloto — Fase 1')
 where atribuido_em is null
returning id, codigo_centro_ctrl, atribuido_em, motivo;
```

**Esperado: exatamente 1 linha** —
`2ead8f87-b7a1-4752-860c-7589acb6aafe` · `00010.00002.00003` · `2026-08-07 19:49:19.440688+00` · `Seed piloto — Fase 1`.

Se vierem **0 linhas**, o Bloco 1 não rodou ou já havia backfill. Se vierem **2+**, pare — havia
mapeamento que o Discovery não viu.

---

## Bloco 3 — `atribuir_lider_cc` (§3.2) · tag `$a1$`

```sql
create or replace function public.atribuir_lider_cc(
  p_user_id uuid,
  p_cc      text,
  p_motivo  text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $a1$
declare
  v_caller  uuid;
  v_role_id uuid;
  v_cc      text := btrim(coalesce(p_cc, ''));
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  -- 1. Gate: is_admin, reusando o helper do Hub (decisão P2)
  if not public.hub_caller_is_admin() then
    return 'SEM_PERMISSAO';
  end if;

  v_caller := auth.uid();

  -- 2. Usuário alvo existe
  if p_user_id is null
     or not exists (select 1 from public.profiles p where p.user_id = p_user_id) then
    return 'USUARIO_INVALIDO';
  end if;

  -- 3. CC existe no universo ativo-folha.
  --    Existência, NUNCA formato (correção §2.2 do Ajuste): há CC ativo com 4 níveis
  --    (00010.00002.00007.00001) e com 6 dígitos no último nível (00008.00002.000012).
  if v_cc = ''
     or not exists (
       select 1 from public.cost_centers c
        where c.erp_code = v_cc and c.is_active and c.group_type = 'F') then
    return 'CC_INVALIDO';
  end if;

  -- 4. Papel resolvido ANTES de qualquer escrita: um `return` não desfaz INSERT já feito.
  select r.id into v_role_id
    from public.hub_roles r
   where r.codigo = 'lider_departamento'
   limit 1;

  if v_role_id is null then
    return 'PAPEL_INEXISTENTE';
  end if;

  -- 5. Upsert do mapeamento (chave: uq compras_lideres_cc_lider_user_id_codigo_centro_ctrl_key).
  --    Reativa limpando a trilha de revogação (F4 / §3.2 passo 4).
  insert into public.compras_lideres_cc
    (lider_user_id, codigo_centro_ctrl, ativo, atribuido_por, atribuido_em,
     revogado_por, revogado_em, motivo)
  values
    (p_user_id, v_cc, true, v_caller, now(), null, null, v_motivo)
  on conflict (lider_user_id, codigo_centro_ctrl) do update
     set ativo         = true,
         atribuido_por = v_caller,
         atribuido_em  = now(),
         revogado_por  = null,
         revogado_em   = null,
         motivo        = v_motivo;

  -- 6. Papel lider_departamento junto, no mesmo ato (F2).
  --    Escreve direto em hub_user_roles (NÃO via hub_assign_role, que é composta e sincroniza
  --    profiles.is_admin — nada disso se aplica), mas preenchendo os MESMOS campos que ela.
  if not exists (
    select 1
      from public.hub_user_roles ur
     where ur.user_id = p_user_id
       and ur.role_id = v_role_id
       and ur.revogado_em is null
  ) then
    insert into public.hub_user_roles (user_id, role_id, atribuido_por, motivo)
    values (p_user_id, v_role_id, v_caller,
            coalesce(v_motivo, 'Atribuído via Mapa de Líderes por Centro de Custo'));
  end if;

  return 'OK';
end;
$a1$;
```

**Esperado:** `Success. No rows returned.`

> **Nota de contrato:** `PAPEL_INEXISTENTE` **não** consta na lista do Ajuste §3.2 (que prevê
> `SEM_PERMISSAO` / `USUARIO_INVALIDO` / `CC_INVALIDO` / `OK`). É retorno defensivo e **nunca deve
> ocorrer** — o papel existe (`4c647f92-cd73-423c-911d-0bdfd8eabf64`, módulo `compras`). Sem ele, a
> função gravaria o mapeamento e sairia sem o papel, quebrando o F2 em silêncio. A tela traduz.

---

## Bloco 4 — grant de `atribuir_lider_cc`

```sql
grant execute on function public.atribuir_lider_cc(uuid, text, text) to authenticated;
```
**Esperado:** `Success. No rows returned.`

## Bloco 5 — revoke `anon` (regra dura do CLAUDE.md)

```sql
revoke execute on function public.atribuir_lider_cc(uuid, text, text) from anon;
```
**Esperado:** `Success. No rows returned.`

## Bloco 6 — revoke `PUBLIC` (fecha o buraco medido no §11.7-B)

```sql
revoke execute on function public.atribuir_lider_cc(uuid, text, text) from public;
```
**Esperado:** `Success. No rows returned.`

> **Por que os DOIS revokes.** O CLAUDE.md manda revogar de `anon`; a medição do PROMPT 1.3-EXEC
> (§11.7-B) provou que **isso sozinho não tranca**: `revoke from anon` tira o grant nominal do
> default privilege do Supabase, mas sobra `=X/postgres` (grantee vazio = **PUBLIC**), o default
> nativo do Postgres, e `anon` herda por ser membro de PUBLIC. **Nenhum dos dois sozinho fecha.**
> O Ajuste §6 (DÍVIDA-REVOKE-PUBLIC) diz que as RPCs desta fase "nascem com o mesmo padrão" das
> irmãs; escrevi os dois revokes para **não criar passivo novo sabendo** — as 3 RPCs desta fase
> nascem fechadas, e a dívida fica restrita às RPCs antigas.
> **Se você preferir manter o padrão das irmãs, pule os blocos 6, 10 e 14** — não muda o
> comportamento (o gate `hub_caller_is_admin()` é a 1ª linha das três funções e `auth.uid()` é null
> em chamada anônima), só a superfície.

---

## Bloco 7 — `revogar_lider_cc` (§3.3) · tag `$r1$`

```sql
create or replace function public.revogar_lider_cc(
  p_user_id uuid,
  p_cc      text
)
returns text
language plpgsql
security definer
set search_path = public
as $r1$
declare
  v_caller    uuid;
  v_role_id   uuid;
  v_cc        text := btrim(coalesce(p_cc, ''));
  v_restantes integer;
  v_pendentes integer;
begin
  -- 1. Mesmo gate
  if not public.hub_caller_is_admin() then
    return 'SEM_PERMISSAO';
  end if;

  v_caller := auth.uid();

  -- 2 e 3. Soft-delete (F4) — nunca DELETE. Só atinge linha ATIVA.
  update public.compras_lideres_cc l
     set ativo        = false,
         revogado_por = v_caller,
         revogado_em  = now()
   where l.lider_user_id      = p_user_id
     and l.codigo_centro_ctrl = v_cc
     and l.ativo;

  if not found then
    return 'NAO_ENCONTRADA';
  end if;

  -- 4. Coerência inversa do F2: se não lidera mais NENHUM CC ativo, revoga o papel.
  select count(*) into v_restantes
    from public.compras_lideres_cc l
   where l.lider_user_id = p_user_id
     and l.ativo;

  if v_restantes = 0 then
    select r.id into v_role_id
      from public.hub_roles r
     where r.codigo = 'lider_departamento'
     limit 1;

    if v_role_id is not null then
      -- soft-delete, mesmos campos que hub_revoke_role preenche
      update public.hub_user_roles ur
         set revogado_em  = now(),
             revogado_por = v_caller
       where ur.user_id = p_user_id
         and ur.role_id = v_role_id
         and ur.revogado_em is null;
    end if;
  end if;

  -- 5. INFORMATIVO (F5): conta pendentes do CC. NENHUMA requisição é lida para escrita
  --    nem alterada — este é o único toque em compras_requisicoes e é um count.
  select count(*) into v_pendentes
    from public.compras_requisicoes r
   where r.codigo_centro_ctrl = v_cc
     and r.status = 'pendente_aprovacao';

  return 'OK:' || v_pendentes::text;
end;
$r1$;
```

**Esperado:** `Success. No rows returned.`

## Bloco 8 — grant

```sql
grant execute on function public.revogar_lider_cc(uuid, text) to authenticated;
```

## Bloco 9 — revoke `anon`

```sql
revoke execute on function public.revogar_lider_cc(uuid, text) from anon;
```

## Bloco 10 — revoke `PUBLIC`

```sql
revoke execute on function public.revogar_lider_cc(uuid, text) from public;
```

---

## Bloco 11 — `listar_mapa_lideres` (§3.4) · tag `$l1$`

```sql
create or replace function public.listar_mapa_lideres()
returns table (
  erp_code        text,
  nome            text,
  department_type text,
  lideres         jsonb,
  qtd_lideres     integer,
  pendentes       integer,
  total_reqs      integer,
  orfao           boolean
)
language plpgsql
security definer
set search_path = public
as $l1$
begin
  -- Gate: sem permissão devolve ZERO linhas (não é erro — a tela já é gateada por is_admin)
  if not public.hub_caller_is_admin() then
    return;
  end if;

  return query
  with universo as (
    -- P1: os 81 CCs ativos-folha, mesma fonte do wizard de requisição
    select c.erp_code           as cc,
           c.name               as cc_nome,
           c.department_type    as cc_dept,
           false                as cc_orfao
      from public.cost_centers c
     where c.is_active
       and c.group_type = 'F'
    union all
    -- P4: mapeamento ativo apontando para CC fora do universo (apagado, expirado ou virou
    --     totalizador). cost_centers não tem FK nem RLS de escrita — esta é a linha de alerta.
    select distinct
           l.codigo_centro_ctrl,
           '(centro de custo inexistente ou inativo)'::text,
           null::text,
           true
      from public.compras_lideres_cc l
     where l.ativo
       and not exists (
         select 1 from public.cost_centers c
          where c.erp_code = l.codigo_centro_ctrl
            and c.is_active
            and c.group_type = 'F')
  ),
  lid as (
    select l.codigo_centro_ctrl as cc,
           jsonb_agg(jsonb_build_object(
             'user_id',      l.lider_user_id,
             'nome',         p.full_name,
             'email',        p.email,
             'atribuido_em', l.atribuido_em
           ) order by p.full_name nulls last, p.email) as js,
           count(*)::integer as qtd
      from public.compras_lideres_cc l
      left join public.profiles p on p.user_id = l.lider_user_id
     where l.ativo
     group by l.codigo_centro_ctrl
  ),
  req as (
    select r.codigo_centro_ctrl as cc,
           count(*)::integer as total,
           (count(*) filter (where r.status = 'pendente_aprovacao'))::integer as pend
      from public.compras_requisicoes r
     group by r.codigo_centro_ctrl
  )
  select u.cc,
         u.cc_nome,
         u.cc_dept,
         coalesce(l.js, '[]'::jsonb),
         coalesce(l.qtd, 0),
         coalesce(q.pend, 0),
         coalesce(q.total, 0),
         u.cc_orfao
    from universo u
    left join lid l on l.cc = u.cc
    left join req q on q.cc = u.cc
   order by u.cc_orfao desc,                    -- órfãos no topo
            (coalesce(l.qtd, 0) = 0) desc,      -- depois os sem líder
            coalesce(q.total, 0) desc,          -- entre eles, os de mais movimento
            u.cc_nome;
end;
$l1$;
```

**Esperado:** `Success. No rows returned.`

> **Nota técnica:** os CTEs usam aliases próprios (`cc`, `cc_nome`, `cc_dept`, `cc_orfao`, `js`,
> `qtd`) **de propósito** — em `RETURNS TABLE` os nomes de saída viram variáveis plpgsql, e reusar
> `erp_code`/`nome`/`orfao` dentro do corpo daria `column reference is ambiguous` em tempo de
> execução (erro que só apareceria na primeira chamada real, não no `create`).

## Bloco 12 — grant

```sql
grant execute on function public.listar_mapa_lideres() to authenticated;
```

## Bloco 13 — revoke `anon`

```sql
revoke execute on function public.listar_mapa_lideres() from anon;
```

## Bloco 14 — revoke `PUBLIC`

```sql
revoke execute on function public.listar_mapa_lideres() from public;
```

---

## Bloco 15 — recarregar o schema cache do PostgREST (por último)

```sql
notify pgrst, 'reload schema';
```

**Esperado:** `Success. No rows returned.` Sem isso o frontend recebe
`function public.listar_mapa_lideres() not found in schema cache`.

---

# 2. Gate de saída (§3.6 do Ajuste)

Rode as 5 conferências **depois** do Bloco 15.

### G1 — Colunas novas + backfill (§3.6.1)

```sql
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='compras_lideres_cc'
      and column_name in ('atribuido_por','atribuido_em','revogado_por','revogado_em','motivo')) as colunas_novas,
  (select count(*) from public.compras_lideres_cc where atribuido_em is null) as sem_atribuido_em,
  (select count(*) from public.compras_lideres_cc) as total_linhas;
```
**Esperado:** `5` · `0` · `1`

### G2 — As 3 funções, com os atributos certos (§3.6.2)

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                                as security_definer,
       p.proconfig                                as config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_pode,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_pode
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and p.proname in ('atribuir_lider_cc','revogar_lider_cc','listar_mapa_lideres')
 order by p.proname;
```
**Esperado: 3 linhas**

| proname | args | security_definer | config | authenticated_pode | anon_pode |
|---|---|---|---|---|---|
| `atribuir_lider_cc` | `p_user_id uuid, p_cc text, p_motivo text` | `true` | `{search_path=public}` | `true` | **`false`** |
| `listar_mapa_lideres` | *(vazio)* | `true` | `{search_path=public}` | `true` | **`false`** |
| `revogar_lider_cc` | `p_user_id uuid, p_cc text` | `true` | `{search_path=public}` | `true` | **`false`** |

Se você **pulou** os blocos 6/10/14, `anon_pode` virá `true` nas três — é o comportamento das RPCs
irmãs já em produção, sem risco de efeito (ver nota do Bloco 6), mas anote no relato.

### G3 — Gate provado sem contexto de auth (§3.6.3)

O SQL Editor roda **sem autenticação**, então `auth.uid()` é null e `hub_caller_is_admin()` é false.

```sql
select count(*) as linhas from public.listar_mapa_lideres();
```
**Esperado: `0`** — prova que o gate funciona. (Um número diferente de 0 aqui é **falha grave**:
significaria que a função devolve o mapa para quem não está autenticado.)

### G4 — `SEM_PERMISSAO` nas duas RPCs de escrita (§3.6.4)

```sql
select public.atribuir_lider_cc('00000000-0000-0000-0000-000000000000'::uuid, 'x', 'teste de gate') as atribuir,
       public.revogar_lider_cc ('00000000-0000-0000-0000-000000000000'::uuid, 'x')                  as revogar;
```
**Esperado:** `SEM_PERMISSAO` · `SEM_PERMISSAO`
Como o gate é a **primeira** linha das duas, nada é escrito — o uuid inexistente e o CC `'x'` nunca
chegam a ser avaliados.

### G5 — Nada foi tocado no fluxo de aprovação (baseline P5)

```sql
select (select count(*) from public.compras_requisicoes)                                   as reqs,
       (select count(*) from public.compras_requisicoes where status='pendente_aprovacao') as pendentes,
       (select count(*) from public.compras_lideres_cc where ativo)                        as mapeamentos_ativos,
       (select count(*) from public.cost_centers where is_active and group_type='F')       as universo_cc;
```
**Esperado:** `309` · **`0`** · `1` · **`81`** — idênticos ao pré-voo.

---

# 3. Rollback

Reverte tudo desta fase. As colunas do Bloco 1 podem ficar (são aditivas e nuláveis); se quiser
remover, o último bloco faz isso.

```sql
drop function if exists public.listar_mapa_lideres();
```
```sql
drop function if exists public.revogar_lider_cc(uuid, text);
```
```sql
drop function if exists public.atribuir_lider_cc(uuid, text, text);
```
```sql
notify pgrst, 'reload schema';
```

Reverter também as colunas (**só se necessário** — apaga a trilha de auditoria já gravada):
```sql
alter table public.compras_lideres_cc
  drop column if exists atribuido_por,
  drop column if exists atribuido_em,
  drop column if exists revogado_por,
  drop column if exists revogado_em,
  drop column if exists motivo;
```

⚠️ **O frontend da Fase 6.2 chama as 3 RPCs.** Derrubá-las sem reverter o commit da tela deixa a
tela `/settings/lideres-cc` com erro `not found in schema cache` — o que é visível e não destrutivo
(nenhuma outra tela usa essas funções).

**Nada aqui é destrutivo:** não há `drop table`, nem `delete`, nem `drop function` de função
existente (os 3 nomes estavam livres — medido no Discovery §5.7), nem alteração em `cost_centers`,
`compras_requisicoes`, RLS, crons ou nas RPCs do fluxo de aprovação.

---

*Fim do SQL da Fase 6.1. Depois: revisão do diff da tela, push, Publicar, validação §5 do Ajuste
(com o Hugo para o teste de não-admin).*
