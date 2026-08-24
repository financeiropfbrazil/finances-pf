# R1.1 — Estrutura de rateio de centro de custo em requisições

Este roteiro deve ser aplicado manualmente no SQL Editor pelo Pedro. A ordem é obrigatória: primeiro as tabelas e seus controles de acesso; somente depois a RPC. Não há backfill neste card.

Contrato de `p_rateio`:

```json
[
  {
    "codigo_classe_rec_desp": "...",
    "classe_rec_desp_label": "...",
    "percentual": 100,
    "ccs": [
      {
        "codigo_centro_ctrl": "...",
        "centro_ctrl_label": "...",
        "percentual": 100
      }
    ]
  }
]
```

`p_rateio = []` é uma substituição válida e remove o rateio anteriormente espelhado. Em uma lista com uma única classe, percentual de classe ausente, nulo ou zero é normalizado para 100. Os percentuais dos CCs continuam obrigatórios.

## 1. PREVIEW

Confirma que os dois nomes de tabela estão livres. Sucesso: duas linhas, ambas com `objeto_existente` nulo.

```sql
select nome, to_regclass('public.' || nome) as objeto_existente
from (values
  ('compras_requisicoes_rateio_classes'),
  ('compras_requisicoes_rateio_cc')
) as v(nome);
```

Confirma que a assinatura nova da RPC ainda não existe. Sucesso: zero linhas.

```sql
select p.oid::regprocedure as assinatura_existente
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'req_replace_rateio'
  and pg_get_function_identity_arguments(p.oid) = 'p_requisicao_id uuid, p_rateio jsonb, p_origem text';
```

## 2. APPLY — tabelas antes da RPC

Cria o nível de classes do rateio de cabeçalho da requisição.

```sql
create table public.compras_requisicoes_rateio_classes (
  id uuid primary key default gen_random_uuid(),
  requisicao_id uuid not null,
  codigo_classe_rec_desp text not null,
  classe_rec_desp_label text null,
  percentual numeric(9,4) not null,
  origem text not null,
  created_at timestamptz not null default now(),
  constraint compras_requisicoes_rateio_classes_requisicao_id_fkey
    foreign key (requisicao_id)
    references public.compras_requisicoes(id)
    on delete cascade,
  constraint compras_requisicoes_rateio_classes_percentual_check
    check (percentual > 0 and percentual <= 100),
  constraint compras_requisicoes_rateio_classes_origem_check
    check (origem in ('hub', 'alvo'))
);
```

Cria o índice da FK do nível de classes.

```sql
create index idx_compras_requisicoes_rateio_classes_requisicao
  on public.compras_requisicoes_rateio_classes (requisicao_id);
```

Habilita RLS no nível de classes.

```sql
alter table public.compras_requisicoes_rateio_classes enable row level security;
```

Replica o padrão de leitura autenticada das tabelas irmãs; escrita de cliente não é aberta.

```sql
create policy compras_requisicoes_rateio_classes_select_authenticated
  on public.compras_requisicoes_rateio_classes
  for select
  to authenticated
  using (true);
```

Cria o nível de centros de custo de cada ocorrência de classe. Não há `unique` de negócio: repetições são preservadas.

```sql
create table public.compras_requisicoes_rateio_cc (
  id uuid primary key default gen_random_uuid(),
  rateio_classe_id uuid not null,
  codigo_centro_ctrl text not null,
  centro_ctrl_label text null,
  percentual numeric(9,4) not null,
  created_at timestamptz not null default now(),
  constraint compras_requisicoes_rateio_cc_rateio_classe_id_fkey
    foreign key (rateio_classe_id)
    references public.compras_requisicoes_rateio_classes(id)
    on delete cascade,
  constraint compras_requisicoes_rateio_cc_percentual_check
    check (percentual > 0 and percentual <= 100)
);
```

Cria o índice da FK do nível de centros de custo.

```sql
create index idx_compras_requisicoes_rateio_cc_classe
  on public.compras_requisicoes_rateio_cc (rateio_classe_id);
```

Habilita RLS no nível de centros de custo.

```sql
alter table public.compras_requisicoes_rateio_cc enable row level security;
```

Replica o padrão de leitura autenticada das tabelas irmãs; escrita de cliente não é aberta.

```sql
create policy compras_requisicoes_rateio_cc_select_authenticated
  on public.compras_requisicoes_rateio_cc
  for select
  to authenticated
  using (true);
```

## 3. APPLY — RPC transacional

A função valida toda a entrada antes do primeiro `delete`; se qualquer validação ou inserção falhar, a chamada inteira sofre rollback. Cada elemento do array representa uma ocorrência de classe, portanto classes e CCs repetidos não são agrupados nem eliminados.

```sql
create or replace function public.req_replace_rateio(
  p_requisicao_id uuid,
  p_rateio jsonb,
  p_origem text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_classe jsonb;
  v_cc jsonb;
  v_ccs jsonb;
  v_classe_id uuid;
  v_qtd_classes integer;
  v_ord_classe integer;
  v_ord_cc integer;
  v_percentual_classe numeric;
  v_percentual_cc numeric;
  v_soma_classes numeric := 0;
  v_soma_cc numeric;
  v_classes_inseridas integer := 0;
  v_ccs_inseridos integer := 0;
begin
  if p_requisicao_id is null then
    raise exception 'REQUISICAO_NULA';
  end if;

  if not exists (
    select 1
    from public.compras_requisicoes
    where id = p_requisicao_id
  ) then
    raise exception 'REQUISICAO_NAO_ENCONTRADA: %', p_requisicao_id;
  end if;

  if p_origem is null or p_origem not in ('hub', 'alvo') then
    raise exception 'ORIGEM_INVALIDA: %', coalesce(p_origem, '<null>');
  end if;

  if jsonb_typeof(p_rateio) is distinct from 'array' then
    raise exception 'RATEIO_DEVE_SER_ARRAY';
  end if;

  v_qtd_classes := jsonb_array_length(p_rateio);

  for v_classe, v_ord_classe in
    select elemento, ordinalidade::integer
    from jsonb_array_elements(p_rateio) with ordinality as e(elemento, ordinalidade)
  loop
    if nullif(btrim(v_classe ->> 'codigo_classe_rec_desp'), '') is null then
      raise exception 'CLASSE_SEM_CODIGO: posicao %', v_ord_classe;
    end if;

    v_percentual_classe := nullif(v_classe ->> 'percentual', '')::numeric;
    if v_qtd_classes = 1 and coalesce(v_percentual_classe, 0) = 0 then
      v_percentual_classe := 100;
    end if;

    if v_percentual_classe is null
       or v_percentual_classe <= 0
       or v_percentual_classe > 100 then
      raise exception 'PERCENTUAL_CLASSE_INVALIDO: posicao %, valor %',
        v_ord_classe,
        coalesce(v_classe ->> 'percentual', '<null>');
    end if;

    v_percentual_classe := round(v_percentual_classe, 4);
    v_soma_classes := v_soma_classes + v_percentual_classe;
    v_ccs := v_classe -> 'ccs';

    if jsonb_typeof(v_ccs) is distinct from 'array' then
      raise exception 'RATEIO_CC_DEVE_SER_ARRAY: classe %', v_ord_classe;
    end if;

    if jsonb_array_length(v_ccs) = 0 then
      raise exception 'CLASSE_SEM_RATEIO_CC: posicao %', v_ord_classe;
    end if;

    v_soma_cc := 0;
    for v_cc, v_ord_cc in
      select elemento, ordinalidade::integer
      from jsonb_array_elements(v_ccs) with ordinality as e(elemento, ordinalidade)
    loop
      if nullif(btrim(v_cc ->> 'codigo_centro_ctrl'), '') is null then
        raise exception 'CC_SEM_CODIGO: classe %, posicao %', v_ord_classe, v_ord_cc;
      end if;

      v_percentual_cc := nullif(v_cc ->> 'percentual', '')::numeric;
      if v_percentual_cc is null
         or v_percentual_cc <= 0
         or v_percentual_cc > 100 then
        raise exception 'PERCENTUAL_CC_INVALIDO: classe %, posicao %, valor %',
          v_ord_classe,
          v_ord_cc,
          coalesce(v_cc ->> 'percentual', '<null>');
      end if;

      v_soma_cc := v_soma_cc + round(v_percentual_cc, 4);
    end loop;

    if round(v_soma_cc, 4) <> 100.0000 then
      raise exception 'SOMA_CC_INVALIDA: classe %, soma %', v_ord_classe, round(v_soma_cc, 4);
    end if;
  end loop;

  if v_qtd_classes > 0 and round(v_soma_classes, 4) <> 100.0000 then
    raise exception 'SOMA_CLASSES_INVALIDA: soma %', round(v_soma_classes, 4);
  end if;

  delete from public.compras_requisicoes_rateio_classes
  where requisicao_id = p_requisicao_id;

  for v_classe, v_ord_classe in
    select elemento, ordinalidade::integer
    from jsonb_array_elements(p_rateio) with ordinality as e(elemento, ordinalidade)
  loop
    v_percentual_classe := nullif(v_classe ->> 'percentual', '')::numeric;
    if v_qtd_classes = 1 and coalesce(v_percentual_classe, 0) = 0 then
      v_percentual_classe := 100;
    end if;

    insert into public.compras_requisicoes_rateio_classes (
      requisicao_id,
      codigo_classe_rec_desp,
      classe_rec_desp_label,
      percentual,
      origem
    ) values (
      p_requisicao_id,
      btrim(v_classe ->> 'codigo_classe_rec_desp'),
      nullif(v_classe ->> 'classe_rec_desp_label', ''),
      round(v_percentual_classe, 4),
      p_origem
    )
    returning id into v_classe_id;

    v_classes_inseridas := v_classes_inseridas + 1;
    v_ccs := v_classe -> 'ccs';

    for v_cc, v_ord_cc in
      select elemento, ordinalidade::integer
      from jsonb_array_elements(v_ccs) with ordinality as e(elemento, ordinalidade)
    loop
      insert into public.compras_requisicoes_rateio_cc (
        rateio_classe_id,
        codigo_centro_ctrl,
        centro_ctrl_label,
        percentual
      ) values (
        v_classe_id,
        btrim(v_cc ->> 'codigo_centro_ctrl'),
        nullif(v_cc ->> 'centro_ctrl_label', ''),
        round((v_cc ->> 'percentual')::numeric, 4)
      );

      v_ccs_inseridos := v_ccs_inseridos + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'classes_inseridas', v_classes_inseridas,
    'ccs_inseridos', v_ccs_inseridos
  );
end;
$fn$;
```

Remove a permissão concedida implicitamente a `PUBLIC` ao criar funções.

```sql
revoke execute on function public.req_replace_rateio(uuid, jsonb, text) from public;
```

Mantém `anon` explicitamente sem execução.

```sql
revoke execute on function public.req_replace_rateio(uuid, jsonb, text) from anon;
```

Mantém `authenticated` explicitamente sem execução; clientes autenticados só leem as tabelas.

```sql
revoke execute on function public.req_replace_rateio(uuid, jsonb, text) from authenticated;
```

Concede execução exclusivamente ao backend com `service_role`.

```sql
grant execute on function public.req_replace_rateio(uuid, jsonb, text) to service_role;
```

Solicita ao PostgREST que recarregue o schema após a criação da assinatura.

```sql
notify pgrst, 'reload schema';
```

## 4. VERIFY

Confere colunas, tipos, nulabilidade e defaults. Sucesso: 13 linhas no total; percentuais como `numeric(9,4)`, FKs UUID e `origem` somente na tabela de classes.

```sql
select table_name, ordinal_position, column_name, data_type, udt_name, numeric_precision, numeric_scale, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('compras_requisicoes_rateio_classes', 'compras_requisicoes_rateio_cc')
order by table_name, ordinal_position;
```

Confere PKs, FKs com cascade e CHECKs. Sucesso: duas PKs, duas FKs com `ON DELETE CASCADE`, dois CHECKs de percentual e um CHECK de origem.

```sql
select c.conrelid::regclass as tabela, c.conname, c.contype, pg_get_constraintdef(c.oid) as definicao
from pg_constraint c
where c.conrelid in (
  'public.compras_requisicoes_rateio_classes'::regclass,
  'public.compras_requisicoes_rateio_cc'::regclass
)
order by c.conrelid::regclass::text, c.contype, c.conname;
```

Confere índices e a ausência de unicidade de negócio. Sucesso: apenas os índices de PK são únicos; os dois índices das FKs aparecem como não únicos.

```sql
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('compras_requisicoes_rateio_classes', 'compras_requisicoes_rateio_cc')
order by tablename, indexname;
```

Confere RLS e políticas. Sucesso: `rowsecurity = true` nas duas tabelas e exatamente uma política `SELECT` para `authenticated` em cada uma.

```sql
select c.relname as tabela, c.relrowsecurity as rls, p.polname, p.polcmd, pg_get_userbyid(p.polroles[1]) as papel
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname in ('compras_requisicoes_rateio_classes', 'compras_requisicoes_rateio_cc')
order by c.relname, p.polname;
```

Confere assinatura, retorno, `SECURITY DEFINER` e `search_path`. Sucesso: uma linha, retorno `jsonb`, `security_definer = true` e configuração `{search_path=public}`.

```sql
select p.oid::regprocedure as assinatura, pg_get_function_result(p.oid) as retorno, p.prosecdef as security_definer, p.proconfig as configuracao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'req_replace_rateio'
  and pg_get_function_identity_arguments(p.oid) = 'p_requisicao_id uuid, p_rateio jsonb, p_origem text';
```

Confere privilégios de execução. Sucesso: `service_role` com `EXECUTE`; nenhuma linha para `PUBLIC`, `anon` ou `authenticated`.

```sql
select grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'req_replace_rateio'
order by grantee;
```

Confere que a aplicação não alterou dados preexistentes. Sucesso imediato deste card: ambas as contagens são zero, pois backfill e sync pertencem aos cards R1.2/R1.3.

```sql
select
  (select count(*) from public.compras_requisicoes_rateio_classes) as classes,
  (select count(*) from public.compras_requisicoes_rateio_cc) as centros_custo;
```
