# SQL-AJUSTE72.md — escopo `view_cc` (AJUSTE 7.2)

> **O agente NÃO executou nada disto.** Todos os blocos são para o Pedro colar no SQL Editor do
> Supabase (projeto `hbtggrbauguukewiknew`), **um bloco por vez, na ordem**, conferindo o resultado
> esperado antes de seguir.
>
> ⚠️ **Tag nomeada em todo `CREATE FUNCTION`** (`$q1$`, `$q2$`) — o SQL Editor confunde variáveis do
> `declare` com nomes de tabela dentro de `$$` anônimo e grava a função **corrompida em silêncio**
> (ESTADO §2).
>
> ⚠️ **Os DOIS revokes** em toda RPC nova (`from anon` **e** `from public`) — receita medida no
> ESTADO §14.3; nenhum dos dois fecha sozinho.
>
> **Pré-voo medido em 02/09/2026** (fingerprint do projeto): `compras_pedidos = 2012` ·
> `compras_requisicoes = 391` · `compras_lideres_cc ativos = 15` · `cost_centers = 186` ·
> `hub_permissions = 67` · permissões `view_cc` existentes: **0** · órfãs do papel `admin`: **0**.

---

## 0. O que este arquivo faz (e o que deliberadamente NÃO faz)

| Bloco | O quê |
|---|---|
| 1–2 | Cria as permissões `compras.requisicoes.view_cc` e `compras.pedidos.view_cc` |
| 3 | Mapeia as duas + `compras.pedidos.access` ao papel `lider_departamento` |
| 4 | Mapeia as duas ao papel `admin` (§8.7 do report — permissão nova nunca nasce órfã do admin) |
| 5 | `notify pgrst` |
| 6–9 | RPC `listar_requisicoes_escopo()` + grant + os 2 revokes |
| 10–13 | RPC `listar_pedidos_escopo(uuid)` + grant + os 2 revokes |
| 14 | `notify pgrst` |
| C1–C7 | Conferências (rodar depois de tudo) |
| §4 | Rollback completo |

🔴 **As duas RPCs resolvem ESCOPO, não fazem a listagem.** Elas devolvem, do servidor, as duas
únicas coisas que o cliente não pode decidir sozinho — **qual escopo o usuário tem** (via
`user_has_permission`) e **quais pedidos o rateio alcança** (o CC vive na tabela **neta**
`compras_pedidos_itens_rateio`, que o PostgREST não filtra sem duplicar o pai e quebrar o `count`).
Filtro, ordenação, paginação e `count` continuam **no banco**, na query que as telas já usam.

**Por que não uma RPC que devolve a página inteira** (o desenho literal do Ajuste §4.2): ela obrigaria
a reescrever em PL/pgSQL a precedência de status de pedido que hoje vive em
`src/lib/statusPedido.ts:338-384` (`aplicarFiltroStatusPedido`), mais 8 campos de busca `ilike`,
origem, comprador, período e ordenação dinâmica. Seria uma **terceira cópia** de regra de status —
o padrão LIVRO × ESPELHO que o `CLAUDE.md` marca como fonte de erro **silencioso e plausível** — e
qualquer divergência de detalhe (NULL em `nullsFirst`, escape do `ilike`) apareceria como
**regressão para quem tem `view_own`/`view_all`**, que é o item nº 1 do gate §6. Este desenho torna
a não-regressão **estrutural**: para quem não tem `view_cc`, a query da tela não muda em nada.

---

## 1. Blocos — RBAC

### Bloco 1 — permissão de requisições

```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.requisicoes.view_cc', 'Ver requisições do centro de custo',
       'Ver todas as requisições dos centros de custo que o usuário lidera', 'compras'
where not exists (select 1 from hub_permissions where codigo = 'compras.requisicoes.view_cc');
```
**Esperado:** `INSERT 0 1`. (Re-rodar dá `INSERT 0 0` — idempotente; há `UNIQUE (codigo)`.)

### Bloco 2 — permissão de pedidos

```sql
insert into hub_permissions (codigo, nome, descricao, modulo)
select 'compras.pedidos.view_cc', 'Ver pedidos do centro de custo',
       'Ver todos os pedidos que oneram os centros de custo que o usuário lidera', 'compras'
where not exists (select 1 from hub_permissions where codigo = 'compras.pedidos.view_cc');
```
**Esperado:** `INSERT 0 1`.

### Bloco 3 — papel `lider_departamento`

```sql
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo = 'lider_departamento'
  and p.codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc','compras.pedidos.access')
  and not exists (select 1 from hub_role_permissions x where x.role_id = r.id and x.permission_id = p.id);
```
**Esperado:** `INSERT 0 3`.
**Medido em 02/09:** o papel tem hoje só `compras.requisicoes.access`, `aprovar`, `create` e
`reenviar_own` — **não tem `compras.pedidos.access`**, e é por isso que ele entra aqui. (Os 4 líderes
de hoje já enxergam o menu de Pedidos porque acumulam o papel `requisitante`; um líder **só**
`lider_departamento` não enxergaria.)

### Bloco 4 — papel `admin` (§8.7 do report)

```sql
insert into hub_role_permissions (role_id, permission_id)
select r.id, p.id from hub_roles r, hub_permissions p
where r.codigo = 'admin'
  and p.codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc')
  and not exists (select 1 from hub_role_permissions x where x.role_id = r.id and x.permission_id = p.id);
```
**Esperado:** `INSERT 0 2`. Hoje há **0 permissões órfãs do admin**; sem este bloco passariam a ser 2.

### Bloco 5 — recarrega o schema do PostgREST

```sql
notify pgrst, 'reload schema';
```
**Esperado:** `NOTIFY`. (Sinal assíncrono — não há objeto a consultar; o efeito real se prova na C7.)

---

## 2. Blocos — RPC de escopo de REQUISIÇÕES

### Bloco 6 — `listar_requisicoes_escopo()`

```sql
create or replace function public.listar_requisicoes_escopo()
returns jsonb
language plpgsql
security definer
set search_path = public
as $q1$
declare
  v_uid    uuid := auth.uid();
  v_admin  boolean := false;
  v_escopo text;
  v_ccs    jsonb := '[]'::jsonb;
begin
  -- Sem sessão não há escopo. Nunca lança exceção: a tela precisa distinguir
  -- "sem permissão" de "a função não existe" (fallback nunca silencioso).
  if v_uid is null then
    return jsonb_build_object('escopo','nenhum','is_admin',false,'ccs','[]'::jsonb,'motivo','SEM_SESSAO');
  end if;

  select coalesce(p.is_admin,false) into v_admin
    from public.profiles p where p.user_id = v_uid limit 1;

  -- Gate de módulo: quem não entra em Requisições não recebe escopo nenhum.
  if not public.user_has_permission(v_uid,'compras.requisicoes.access') then
    return jsonb_build_object('escopo','nenhum','is_admin',v_admin,'ccs','[]'::jsonb,'motivo','SEM_ACESSO_AO_MODULO');
  end if;

  -- Hierarquia: all > cc > own. user_has_permission já devolve TRUE para is_admin,
  -- então o ramo 'all' cobre o administrador sem precisar de bypass próprio.
  if public.user_has_permission(v_uid,'compras.requisicoes.view_all') then
    v_escopo := 'all';
  elsif public.user_has_permission(v_uid,'compras.requisicoes.view_cc') then
    v_escopo := 'cc';
    select coalesce(jsonb_agg(distinct c.codigo_centro_ctrl order by c.codigo_centro_ctrl), '[]'::jsonb)
      into v_ccs
      from public.compras_lideres_cc c
     where c.lider_user_id = v_uid and c.ativo;
  elsif public.user_has_permission(v_uid,'compras.requisicoes.view_own') then
    v_escopo := 'own';
  else
    v_escopo := 'nenhum';
  end if;

  return jsonb_build_object('escopo',v_escopo,'is_admin',v_admin,'ccs',v_ccs,'motivo',null);
end;
$q1$;
```
**Esperado:** `CREATE FUNCTION`.

### Bloco 7 — grant

```sql
grant execute on function public.listar_requisicoes_escopo() to authenticated;
```
**Esperado:** `GRANT`.

### Bloco 8 — revoke de `anon`

```sql
revoke execute on function public.listar_requisicoes_escopo() from anon;
```
**Esperado:** `REVOKE`. (Sozinho **não** fecha — ver Bloco 9.)

### Bloco 9 — revoke de `public`

```sql
revoke execute on function public.listar_requisicoes_escopo() from public;
```
**Esperado:** `REVOKE`. Só depois deste `has_function_privilege('anon', …)` vira `false`.

---

## 3. Blocos — RPC de escopo de PEDIDOS

### Bloco 10 — `listar_pedidos_escopo(uuid)`

```sql
create or replace function public.listar_pedidos_escopo(p_pedido_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $q2$
declare
  c_teto      constant integer := 800;
  v_uid       uuid := auth.uid();
  v_admin     boolean := false;
  v_escopo    text;
  v_ccs       text[] := array[]::text[];
  v_pedidos   jsonb := '[]'::jsonb;
  v_qtd       integer := 0;
  v_truncado  boolean := false;
  v_permitido boolean;
begin
  if v_uid is null then
    return jsonb_build_object('escopo','nenhum','is_admin',false,'ccs','[]'::jsonb,
                              'pedidos_cc','[]'::jsonb,'truncado',false,'permitido',false,'motivo','SEM_SESSAO');
  end if;

  select coalesce(p.is_admin,false) into v_admin
    from public.profiles p where p.user_id = v_uid limit 1;

  if not public.user_has_permission(v_uid,'compras.pedidos.access') then
    return jsonb_build_object('escopo','nenhum','is_admin',v_admin,'ccs','[]'::jsonb,
                              'pedidos_cc','[]'::jsonb,'truncado',false,'permitido',false,'motivo','SEM_ACESSO_AO_MODULO');
  end if;

  if public.user_has_permission(v_uid,'compras.pedidos.view_all') then
    v_escopo := 'all';
  elsif public.user_has_permission(v_uid,'compras.pedidos.view_cc') then
    v_escopo := 'cc';
    select coalesce(array_agg(distinct c.codigo_centro_ctrl), array[]::text[])
      into v_ccs
      from public.compras_lideres_cc c
     where c.lider_user_id = v_uid and c.ativo;
  elsif public.user_has_permission(v_uid,'compras.pedidos.view_own') then
    v_escopo := 'own';
  else
    v_escopo := 'nenhum';
  end if;

  -- ── MODO 1: pergunta sobre UM pedido (tela de detalhe) ────────────────────
  if p_pedido_id is not null then
    if v_escopo = 'all' then
      v_permitido := exists (select 1 from public.compras_pedidos p where p.id = p_pedido_id);
    else
      v_permitido := exists (
        select 1 from public.compras_pedidos p
         where p.id = p_pedido_id
           and (
             -- PRÓPRIO — piso que já existia na tela: pedido derivado de requisição
             -- criada por mim (mesma dupla numero_req_comp + filial da tela de hoje).
             exists (select 1 from public.compras_requisicoes r
                      where r.numero_alvo = p.numero_req_comp
                        and r.codigo_empresa_filial = p.codigo_empresa_filial_req_comp
                        and r.requisitante_user_id = v_uid)
             -- POR CC — cabeçalho do pedido
             or (v_escopo = 'cc' and p.centro_custo = any(v_ccs))
             -- POR CC — rateio (tabela neta), qualquer percentual
             or (v_escopo = 'cc' and exists (
                   select 1 from public.compras_pedidos_itens i
                     join public.compras_pedidos_itens_rateio x on x.item_id = i.id
                    where i.pedido_id = p.id and x.codigo_centro_ctrl = any(v_ccs)))
           ));
    end if;

    return jsonb_build_object('escopo',v_escopo,'is_admin',v_admin,'ccs',to_jsonb(v_ccs),
                              'pedidos_cc','[]'::jsonb,'truncado',false,'permitido',v_permitido,'motivo',null);
  end if;

  -- ── MODO 2: listagem ──────────────────────────────────────────────────────
  -- Devolve SÓ o que o cliente não consegue expressar: os pedidos alcançados pelo
  -- RATEIO nos meus CCs, com quais CCs os alcançaram (o chip da tela usa isso).
  -- Cabeçalho (centro_custo) e "derivado das minhas requisições" a tela filtra
  -- sozinha, no banco, com os filtros que já tem.
  if v_escopo = 'cc' and array_length(v_ccs,1) is not null then
    select count(*) into v_qtd from (
      select distinct i.pedido_id
        from public.compras_pedidos_itens i
        join public.compras_pedidos_itens_rateio x on x.item_id = i.id
       where x.codigo_centro_ctrl = any(v_ccs)) t;

    v_truncado := v_qtd > c_teto;

    select coalesce(jsonb_agg(jsonb_build_object('id', t.pedido_id, 'ccs', t.ccs)), '[]'::jsonb)
      into v_pedidos
      from (
        select i.pedido_id,
               jsonb_agg(distinct x.codigo_centro_ctrl) as ccs,
               max(p.data_pedido) as data_ref
          from public.compras_pedidos_itens i
          join public.compras_pedidos_itens_rateio x on x.item_id = i.id
          join public.compras_pedidos p on p.id = i.pedido_id
         where x.codigo_centro_ctrl = any(v_ccs)
         group by i.pedido_id
         order by max(p.data_pedido) desc nulls last
         limit c_teto) t;
  end if;

  return jsonb_build_object('escopo',v_escopo,'is_admin',v_admin,'ccs',to_jsonb(v_ccs),
                            'pedidos_cc',v_pedidos,'truncado',v_truncado,'permitido',null,'motivo',null);
end;
$q2$;
```
**Esperado:** `CREATE FUNCTION`.
**Dimensão medida hoje (02/09):** o maior conjunto por rateio entre os líderes atuais é **25 pedidos**
(Ana) — o teto de 800 existe para o dia em que o rateio for a regra, não a exceção, e quando ele
morder a tela **avisa** (`truncado: true`), nunca corta calada.

### Bloco 11 — grant

```sql
grant execute on function public.listar_pedidos_escopo(uuid) to authenticated;
```
**Esperado:** `GRANT`.

### Bloco 12 — revoke de `anon`

```sql
revoke execute on function public.listar_pedidos_escopo(uuid) from anon;
```
**Esperado:** `REVOKE`.

### Bloco 13 — revoke de `public`

```sql
revoke execute on function public.listar_pedidos_escopo(uuid) from public;
```
**Esperado:** `REVOKE`.

### Bloco 14 — recarrega o schema

```sql
notify pgrst, 'reload schema';
```
**Esperado:** `NOTIFY`.

---

## 4. Conferências (rodar DEPOIS dos 14 blocos)

### C1 — as duas permissões existem, uma vez cada

```sql
select codigo, nome, modulo from hub_permissions
where codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc') order by codigo;
```
**Esperado:** 2 linhas, módulo `compras`, acentuação íntegra ("requisições", "usuário").

### C2 — mapeamento dos papéis

```sql
select r.codigo as papel, p.codigo as permissao
from hub_role_permissions rp
join hub_roles r on r.id = rp.role_id
join hub_permissions p on p.id = rp.permission_id
where p.codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc','compras.pedidos.access')
  and r.codigo in ('lider_departamento','admin')
order by 1,2;
```
**Esperado:** 5 linhas — `admin` × 2 (`pedidos.view_cc`, `requisicoes.view_cc`) e
`lider_departamento` × 3 (`pedidos.access`, `pedidos.view_cc`, `requisicoes.view_cc`).

### C3 — 🔴 gate de saída §6.6: permissões órfãs do papel `admin`

```sql
select p.codigo from hub_permissions p
where not exists (select 1 from hub_role_permissions rp join hub_roles r on r.id = rp.role_id
                   where rp.permission_id = p.id and r.codigo = 'admin')
order by 1;
```
**Esperado:** **0 linhas** (era 0 antes; tem de continuar 0). Se as duas novas aparecerem aqui, o
Bloco 4 não pegou.

### C4 — as 2 RPCs existem, com o ACL certo

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid)              as args,
       p.prosecdef                                            as definer,
       p.proconfig                                            as config,
       has_function_privilege('authenticated', p.oid,'EXECUTE') as authenticated_pode,
       has_function_privilege('anon',          p.oid,'EXECUTE') as anon_pode
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in ('listar_requisicoes_escopo','listar_pedidos_escopo')
order by 1;
```
**Esperado:** 2 linhas · `definer = true` · `config = {search_path=public}` ·
`authenticated_pode = true` · **`anon_pode = false` nas duas** (é o que os Blocos 8+9 / 12+13 compram;
com só um dos revokes isto sai `true` — ESTADO §14.3).

### C5 — o corpo gravado é o corpo enviado (armadilha da tag `$$`)

```sql
select p.proname,
       position('user_has_permission' in pg_get_functiondef(p.oid)) > 0 as tem_gate,
       position('compras_lideres_cc'  in pg_get_functiondef(p.oid)) > 0 as le_mapa,
       position('$$'                  in pg_get_functiondef(p.oid)) > 0 as tem_dollar_anonimo
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in ('listar_requisicoes_escopo','listar_pedidos_escopo')
order by 1;
```
**Esperado:** `tem_gate = true`, `le_mapa = true` e `tem_dollar_anonimo = false` nas duas.

### C6 — o gate responde (chamada real, sem sessão)

```sql
select public.listar_requisicoes_escopo() as req, public.listar_pedidos_escopo() as ped;
```
**Esperado:** nos dois, `escopo = "nenhum"` e `motivo = "SEM_SESSAO"` — o SQL Editor roda **sem
autenticação**, então `auth.uid()` é nulo. Isto prova que a função **existe e executa**; o corpo com
CCs só roda na primeira chamada real do app (a lição do ESTADO §12.7-C: gate que barra na 1ª linha
não prova o resto).

### C7 — o PostgREST enxerga as funções (o `notify` pegou)

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in ('listar_requisicoes_escopo','listar_pedidos_escopo');
```
**Esperado:** `2`. Se o app disser `PGRST202 / function not found in schema cache`, repita o Bloco 14.

### C8 — leitura de conferência: o que a Ana e o Caio passam a ver

```sql
with u as (select user_id, full_name, funcionario_alvo_codigo from profiles
            where email in ('ana.sanches@pfbrazil.com','caio.santos@pfbrazil.com','hugo.maffei@pfbrazil.com')),
     ccs as (select lider_user_id, codigo_centro_ctrl from compras_lideres_cc where ativo)
select u.full_name,
  (select count(*) from compras_requisicoes r
    where r.requisitante_user_id = u.user_id
       or (u.funcionario_alvo_codigo is not null and r.codigo_funcionario = u.funcionario_alvo_codigo)) as req_hoje,
  (select count(*) from compras_requisicoes r
    where r.requisitante_user_id = u.user_id
       or (u.funcionario_alvo_codigo is not null and r.codigo_funcionario = u.funcionario_alvo_codigo)
       or (r.status <> 'rascunho'
           and r.codigo_centro_ctrl in (select codigo_centro_ctrl from ccs where lider_user_id = u.user_id))) as req_depois
from u order by 1;
```
**Esperado (medido em 02/09, antes do SQL):** ana `7 → 57` · caio `0 → 12` · Hugo `12 → 12`.
Hugo é a testemunha de **não-regressão**: ele não lidera nada, o número não pode mudar.

---

## 5. Rollback

Na ordem inversa. Derrubar só as funções já basta para a tela voltar ao comportamento de hoje — o
frontend trata `PGRST202` como "escopo indisponível" e cai no filtro `view_own`/`view_all` de sempre,
avisando no console (nunca em silêncio).

```sql
drop function if exists public.listar_pedidos_escopo(uuid);
```
```sql
drop function if exists public.listar_requisicoes_escopo();
```
```sql
delete from hub_role_permissions rp
 using hub_permissions p
 where rp.permission_id = p.id
   and p.codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc');
```
```sql
delete from hub_permissions where codigo in ('compras.requisicoes.view_cc','compras.pedidos.view_cc');
```
```sql
notify pgrst, 'reload schema';
```

⚠️ O `delete` do mapeamento **não** desfaz o `compras.pedidos.access` concedido ao
`lider_departamento` no Bloco 3 — de propósito: é permissão de módulo, não do escopo novo, e tirá-la
esconderia o menu de Pedidos de quem já estiver usando. Para reverter também isso:

```sql
delete from hub_role_permissions rp
 using hub_roles r, hub_permissions p
 where rp.role_id = r.id and rp.permission_id = p.id
   and r.codigo = 'lider_departamento' and p.codigo = 'compras.pedidos.access';
```
