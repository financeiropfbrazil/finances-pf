# SQL-AJUSTE13.md — Motivos estruturados de rejeição (AJUSTE 1.3, §3 e §4)

> **Executor: Pedro**, no SQL Editor do Supabase (projeto `hbtggrbauguukewiknew`).
> O agente **não executou nada** — o MCP está em `read_only=true`.
> **Um bloco por Run**, na ordem abaixo. Não juntar blocos: o SQL Editor abandona `BEGIN/COMMIT` em silêncio.
>
> ⚠️ **Todo `CREATE FUNCTION` aqui usa TAG NOMEADA** (`$trg$`, `$r3$`, `$r1$`) e nunca `$$` puro.
> O pré-processador do SQL Editor confunde variáveis do bloco `declare` com nomes de tabela dentro de
> corpos `$$ … $$` e grava a função **corrompida, sem erro na tela** (armadilha registrada no
> `ESTADO-APROVACAO-REQ.md` §2). Se uma função se comportar de forma estranha depois de "executar com
> sucesso", a primeira hipótese é esta — conferir o corpo real com `pg_get_functiondef`.
>
> **Rollback:** os blocos 1–5 são aditivos (tabela e coluna novas; nada é apagado). Os blocos 7, 9 e 11
> recriam funções — o texto exato das versões atuais está no §Rollback ao final.

---

## Bloco 0 — Pré-voo (read-only, opcional mas recomendado)

```sql
select current_database() as db,
       (select count(*) from compras_pedidos) as pedidos_1820_esperado,
       (select count(*) from compras_requisicoes) as reqs,
       (select count(*) from compras_requisicoes where status='rejeitada') as rejeitadas,
       (select to_regclass('public.compras_motivos_rejeicao')::text) as tabela_motivos;
```

**Esperado:** `db=postgres`, `pedidos ≈ 1820` (fingerprint do projeto certo), `rejeitadas = 1`
(a do Hugo, de 10/08), `tabela_motivos = null` (ainda não existe).

```sql
select pid, usename, state, xact_start, left(query,80) q
from pg_stat_activity
where state <> 'idle' and xact_start < now() - interval '2 minutes';
```

**Esperado:** zero linhas (nenhuma transação velha segurando lock).

---

## Bloco 1 — Catálogo de motivos (tabela)

```sql
create table if not exists public.compras_motivos_rejeicao (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  rotulo text not null,
  exige_observacao boolean not null default false,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
```

**Esperado:** `Success. No rows returned`.
ℹ️ O SQL Editor injeta por conta própria um `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ao ver um
`create table`. Aqui isso é inofensivo — é exatamente o que o Bloco 2 faz de novo (idempotente).

---

## Bloco 2 — RLS na tabela nova

```sql
alter table public.compras_motivos_rejeicao enable row level security;
```

**Esperado:** `Success. No rows returned`.

---

## Bloco 3 — Policy de leitura (sem escrita: gestão é por SQL Editor)

```sql
create policy motivos_rejeicao_select on public.compras_motivos_rejeicao
  for select to authenticated using (true);
```

**Esperado:** `Success. No rows returned`.
Se o Bloco 1 já tiver sido rodado antes e a policy existir, o erro é
`policy "motivos_rejeicao_select" for table "compras_motivos_rejeicao" already exists` — pode seguir.

---

## Bloco 4 — Seed dos 10 motivos

```sql
insert into public.compras_motivos_rejeicao (codigo, rotulo, exige_observacao, ordem) values
  ('gestao_custos',    'Gestão de custos',                 false,  10),
  ('sem_verba',        'Sem verba no período',             false,  20),
  ('duplicidade',      'Duplicidade (já requisitado)',     false,  30),
  ('ja_em_estoque',    'Já disponível em estoque',         false,  40),
  ('cc_incorreto',     'Centro de custo incorreto',        false,  50),
  ('classe_incorreta', 'Classificação contábil incorreta', false,  60),
  ('item_incorreto',   'Item/especificação incorreta',     false,  70),
  ('sem_necessidade',  'Sem necessidade da compra',        false,  80),
  ('reprogramar',      'Fora do momento (reprogramar)',    false,  90),
  ('outros',           'Outros',                           true,  100)
on conflict (codigo) do nothing;
```

**Esperado:** `Success. 10 rows` (ou menos, se algum já existisse — o `on conflict` protege).

---

## Bloco 5 — Coluna do código do motivo na requisição

```sql
alter table public.compras_requisicoes
  add column if not exists motivo_rejeicao_codigo text;
```

**Esperado:** `Success. No rows returned`.
`motivo_rejeicao` (text) **permanece** e passa a guardar a **observação**. Rejeições antigas ficam com
`motivo_rejeicao_codigo` nulo — comportamento esperado (decisão G4).

---

## Bloco 6 — Recarregar o schema do PostgREST

```sql
notify pgrst, 'reload schema';
```

**Esperado:** `Success. No rows returned`.
⚠️ **Obrigatório antes de qualquer teste pela API/frontend** — é a causa nº 1 de falso erro
"column does not exist".

---

## Bloco 7 — Trigger de proteção passa a cobrir `motivo_rejeicao_codigo`

Sem isto, a coluna nova fica **gravável por API direta** (a RLS da família é `ALL using(true)` —
DÍVIDA-RLS-COMPRAS-REQ). Recriada **preservando tudo**: continua `SECURITY INVOKER` (o `current_user`
precisa refletir quem chama) e **sem** `set search_path` — a função não referencia tabela alguma.
As duas únicas mudanças estão marcadas com `-- AJUSTE 1.3`.

```sql
create or replace function public.fn_req_protege_aprovacao()
returns trigger
language plpgsql
-- SECURITY INVOKER (default) DE PROPÓSITO: current_user precisa refletir quem chama
as $trg$
declare
  protegidos constant text[] := array['pendente_aprovacao','aprovada','rejeitada'];
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status = any(protegidos)
         or new.aprovada_por_user_id is not null or new.aprovada_em is not null
         or new.rejeitada_por_user_id is not null or new.rejeitada_em is not null
         or new.motivo_rejeicao is not null
         or new.motivo_rejeicao_codigo is not null   -- AJUSTE 1.3
         or coalesce(new.aprovacao_automatica,false) then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovacao (insert)';
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
         or new.motivo_rejeicao       is distinct from old.motivo_rejeicao
         or new.motivo_rejeicao_codigo is distinct from old.motivo_rejeicao_codigo  -- AJUSTE 1.3
      then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovacao (update)';
      end if;
      return new;
    else
      if old.status = any(protegidos) then
        raise exception 'PROTEGIDO_APROVACAO: registro do fluxo de aprovacao nao pode ser excluido via API';
      end if;
      return old;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$trg$;
```

**Esperado:** `Success. No rows returned`.
ℹ️ O trigger `trg_req_protege_aprovacao` **não precisa ser recriado** — ele aponta para a função, que
acabou de ser substituída no lugar.

---

## Bloco 8 — Dropar a assinatura ANTIGA de `rejeitar_requisicao`

Deixar as duas vivas manteria um caminho que pula o catálogo (§4.1 item 1).

```sql
drop function if exists public.rejeitar_requisicao(uuid, text);
```

**Esperado:** `Success. No rows returned`.

---

## Bloco 9 — `rejeitar_requisicao` com a assinatura nova

Preserva **todos** os gates da versão em produção (`auth.uid() is null`, `user_has_permission`,
`FOR UPDATE`, `status='pendente_aprovacao'`, `is_admin`/escopo por CC) e acrescenta a validação do
catálogo. `SECURITY DEFINER` + `search_path` redeclarados (o `CREATE OR REPLACE` não os preserva).

```sql
create function public.rejeitar_requisicao(p_req_id uuid, p_motivo_codigo text, p_observacao text)
returns text
language plpgsql
security definer
set search_path = public
as $r3$
declare
  v_req record;
  v_admin boolean;
  v_motivo record;
  v_obs text;
begin
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  -- AJUSTE 1.3: motivo vem do catálogo (G3). A checagem de permissão vem ANTES da
  -- do catálogo de propósito: quem não pode aprovar não descobre o catálogo pelos erros.
  select * into v_motivo
    from compras_motivos_rejeicao
   where codigo = p_motivo_codigo and ativo;
  if not found then return 'MOTIVO_INVALIDO'; end if;

  v_obs := nullif(trim(coalesce(p_observacao, '')), '');
  if v_motivo.exige_observacao and (v_obs is null or length(v_obs) < 5) then
    return 'OBSERVACAO_OBRIGATORIA';
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
     set status='rejeitada',
         rejeitada_por_user_id=auth.uid(),
         rejeitada_em=now(),
         motivo_rejeicao_codigo=v_motivo.codigo,
         motivo_rejeicao=v_obs,
         updated_at=now()
   where id = p_req_id;

  perform public._req_evento(p_req_id, 'rejeitada_lider',
           jsonb_build_object('motivo_codigo', v_motivo.codigo,
                              'motivo_rotulo', v_motivo.rotulo,
                              'observacao', v_obs,
                              'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$r3$;
```

**Esperado:** `Success. No rows returned`.

---

## Bloco 10 — Grants da assinatura nova (⚠️ inclui o `revoke ... from anon`)

Função **nova** em `public` nasce com EXECUTE concedido **nominalmente a `anon`** (default privilege do
Supabase). `revoke … from public` **não** alcança grant nominal — tem que ser `from anon`, com a
assinatura completa. (Regra do `CLAUDE.md`; foi o que faltou na OP-2.7.)

```sql
grant execute on function public.rejeitar_requisicao(uuid, text, text) to authenticated;
```

```sql
revoke execute on function public.rejeitar_requisicao(uuid, text, text) from anon;
```

**Esperado:** `Success. No rows returned` em cada um.

---

## Bloco 11 — `submeter_requisicao` limpa `erro_ultimo_envio` ao rotear

Elimina o estado contraditório "Pendente aprovação **+** Erro no último envio" (o que apareceu na
validação do Hugo). Mudanças marcadas com `-- AJUSTE 1.3`; todo o resto é idêntico ao que está em
produção hoje.

⚠️ **Diferença em relação ao texto do Ajuste §4.2:** o ramo `SEM_GATE` **não tinha `UPDATE` nenhum**
(só gravava auditoria e retornava). Para cumprir "os três desfechos limpam o erro", um `UPDATE`
**novo** foi acrescentado ali. É seguro: nesse ponto a requisição está em `rascunho`, que não é
estado protegido pelo trigger.

```sql
create or replace function public.submeter_requisicao(p_req_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $r1$
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
    -- AJUSTE 1.3: este ramo não tinha UPDATE; passa a existir só para limpar o erro
    -- da tentativa anterior (o envio legado, logo em seguida, grava o desfecho real).
    update compras_requisicoes
       set erro_ultimo_envio = null, updated_at = now()
     where id = p_req_id;
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
           aprovacao_automatica=true,
           erro_ultimo_envio=null,          -- AJUSTE 1.3
           updated_at=now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'aprovada_lider',
             jsonb_build_object('automatica', true, 'cc', v_req.codigo_centro_ctrl));
    return 'AUTO_APROVADA';
  end if;

  update compras_requisicoes
     set status='pendente_aprovacao',
         erro_ultimo_envio=null,            -- AJUSTE 1.3
         updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'enviada_aprovacao',
           jsonb_build_object('cc', v_req.codigo_centro_ctrl));
  return 'PENDENTE';
end;
$r1$;
```

**Esperado:** `Success. No rows returned`.
ℹ️ `create or replace` sobre função **existente** preserva o ACL — não precisa repetir grants aqui.

---

## Bloco 12 — Recarregar o schema (por último)

```sql
notify pgrst, 'reload schema';
```

**Esperado:** `Success. No rows returned`.

---

# Conferências do gate de saída (§7)

## C1 — §7.2: assinatura antiga sumiu, a nova existe e está com grant certo

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as assinatura,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_pode,
       has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_pode
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='rejeitar_requisicao';
```

**Esperado: exatamente 1 linha**

| proname | assinatura | security_definer | authenticated_pode | anon_pode |
|---|---|---|---|---|
| `rejeitar_requisicao` | `p_req_id uuid, p_motivo_codigo text, p_observacao text` | `true` | `true` | **`false`** |

❌ Se aparecerem **2 linhas**, o Bloco 8 não rodou — o caminho velho continua vivo e pula o catálogo.
❌ Se `anon_pode = true`, o `revoke` do Bloco 10 não pegou.

## C2 — §7.3: o trigger protege `motivo_rejeicao_codigo`

```sql
select position('motivo_rejeicao_codigo' in pg_get_functiondef(p.oid)) > 0 as protege_coluna_nova,
       position('$trg$' in pg_get_functiondef(p.oid)) as tag_nomeada_nao_deve_aparecer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='fn_req_protege_aprovacao';
```

**Esperado:** `protege_coluna_nova = true`. (A segunda coluna sai `0`: o Postgres normaliza a tag ao
gravar, então ela não aparece no `functiondef` — é só um sinal de que o corpo foi lido inteiro.)

Prova do corpo real, se quiser ler com os próprios olhos:
```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname='fn_req_protege_aprovacao';
```
Deve conter **as duas** linhas novas: `new.motivo_rejeicao_codigo is not null` (ramo INSERT) e
`new.motivo_rejeicao_codigo is distinct from old.motivo_rejeicao_codigo` (ramo UPDATE).

## C3 — catálogo e coluna no lugar

```sql
select codigo, rotulo, exige_observacao, ordem, ativo
from compras_motivos_rejeicao order by ordem;
```
**Esperado:** 10 linhas, `outros` com `exige_observacao = true`, ordem 10…100.

```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='compras_requisicoes'
  and column_name in ('motivo_rejeicao','motivo_rejeicao_codigo');
```
**Esperado:** 2 linhas, ambas `text`.

## C4 — a rejeição antiga do Hugo continua íntegra (retrocompatibilidade, G4)

```sql
select id, status, motivo_rejeicao, motivo_rejeicao_codigo, rejeitada_em
from compras_requisicoes where status='rejeitada';
```
**Esperado:** 1 linha, com `motivo_rejeicao` preenchido (texto livre) e
`motivo_rejeicao_codigo = null`. É o comportamento previsto — a tela sabe exibir esse caso.

## C5 — smoke test das RPCs (opcional)

O SQL Editor roda **sem autenticação**, então `auth.uid()` é nulo:

```sql
select public.rejeitar_requisicao(gen_random_uuid(), 'gestao_custos', null);
```
**Esperado:** `SEM_PERMISSAO` — prova que a função está viva e que o gate de auth funciona.
(Qualquer outro retorno, ou erro de "function does not exist", indica problema.)

---

# Rollback

Os blocos 1–6 são aditivos: para desfazer, `drop table public.compras_motivos_rejeicao;` e
`alter table public.compras_requisicoes drop column motivo_rejeicao_codigo;` — **mas** isso só é
seguro antes de qualquer rejeição nova ter usado o catálogo.

Para as funções, o texto **exato** que está em produção hoje (10/08/2026, antes deste Ajuste) está
preservado no `ESTADO-APROVACAO-REQ.md` §11.5. Restaurar = recolar aquelas definições, sempre com tag
nomeada. Atenção: voltar `rejeitar_requisicao` para `(uuid, text)` exige também reverter o frontend,
que passa a chamar com 3 parâmetros.
