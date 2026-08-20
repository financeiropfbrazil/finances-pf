# FS2 — Movimento: batelada, entrada, consumo, produção e refugo

**Criado em:** 20/08/2026 · **Libera:** a fase FS2, que estava `bloqueada` no §3 do `PLANO-SALAS.md`
**Pré-requisito cumprido:** FS1 concluída (SESSÃO S2) **e validada** (§7: teste com usuário sem
`is_admin` devolveu `pode_entrada = true`, `pode_estornar = false`).

> Este arquivo é **aditivo**. Não altera nada escrito no `PLANO-SALAS.md` nem no
> `sql/FS1-fundacao.sql`. Todos os guardrails do §1 do plano continuam valendo integralmente —
> em especial: escopo cercado a objetos `prod_*` e catálogo `salas`, zero DROP/DELETE/TRUNCATE,
> parou-divergiu-reportou, janela de DDL, revokes de `anon` com assinatura completa, e
> `NOTIFY pgrst` ao final.

---

## §A — Decisões de negócio desta fase (fechadas com o Pedro; executar, não rediscutir)

1. **Batelada é a espinha dorsal.** A sala abre uma batelada, declara o consumo de insumos,
   produz, e fecha declarando quantas peças boas saíram. Isso dá: baixa real do insumo,
   rendimento por batelada e **genealogia lote-a-lote** (cada peça sabe de que lote de silicone
   nasceu) — requisito de rastreabilidade para dispositivo classe III/IV.
2. **Várias bateladas por dia, por sala.** Numeração `<PREFIXO>-AAMMDD-NN`, com `NN` sequencial
   por sala e por dia (ex.: `PT-260820-01`, `PT-260820-02`). Gerada pelo Hub, **nunca digitada**.
3. **O número da batelada É o lote de produção** da peça. Ele vai no campo `lote_producao` da
   saída e fecha a rastreabilidade quando a peça for criada no Alvo (fase futura).
4. **Silicone e bário são registrados em GRAMAS** (unidade base do cadastro, já pré-selecionada
   na UI). KG e UNID seguem disponíveis como escape.
5. **Entrada bloqueia lote vencido** (regra da FS1, mantida): `validade_lote < data_movimento`
   → exceção, sem override.
6. **Estorno com janela de 60 minutos.** O autor do registro pode estornar o **próprio**
   lançamento em até 60 minutos, usando a permissão de registrar daquele tipo. Passado isso, só
   quem tem `salas.estornar` (gestor). Sempre soft-estorno; nunca UPDATE de quantidade, nunca
   DELETE.
7. **Refugo é de insumo E de peça pronta**, com listas de motivos distintas.

### A.1 Duas perguntas ainda abertas — resolvidas como DADO, não como schema

Estas duas ficaram pendentes na conversa com a produção. O desenho abaixo as acomoda **sem
travar nada**, para não exigir remodelagem depois:

- **Motivos de refugo de insumo:** os 5 de peça pronta são os da planilha do Pedro (definitivos).
  Os 6 de insumo são **proposta a validar** com a sala — entram semeados e podem ser
  desativados/renomeados/acrescentados por UPDATE em `prod_sala_motivos_refugo`, sem DDL.
- **Consumo declarado na abertura ou no fechamento:** a coluna `momento` em
  `prod_batelada_consumos` aceita `ABERTURA` **e** `FECHAMENTO`. A RPC permite declarar nos dois
  pontos; qual a sala vai usar é decisão de UI/operação, não de banco.

### A.2 Simplificação assumida no MVP (registrada de propósito)

O saldo da sala controla **insumos**. A peça produzida é declarada no fechamento e assume-se que
**segue imediatamente** para a próxima etapa (não fica estocada na sala). Se a sala passar a
guardar peça pronta, isso vira uma frente nova — não é remendo desta.

---

## §B — Tarefas (adicionar estas linhas ao Quadro de Status §3 do plano)

| Fase | Tarefa | Descrição |
|---|---|---|
| FS2 | FS2-0 | Pré-voo da fase (leituras) |
| FS2 | FS2-1 | `prod_sala_motivos_refugo` + semeadura (5 peça + 6 insumo) |
| FS2 | FS2-2 | `prod_salas`: ADD COLUMN `prefixo_lote` + set `PT` |
| FS2 | FS2-3 | `prod_bateladas` |
| FS2 | FS2-4 | `prod_batelada_consumos` |
| FS2 | FS2-5 | `prod_saidas` |
| FS2 | FS2-6 | `prod_refugos` |
| FS2 | FS2-7 | Permissão `salas.batelada.manage` + mapeamentos (inclui `admin`) |
| FS2 | FS2-8 | RPC `prod_registrar_entrada` |
| FS2 | FS2-9 | RPCs de batelada (abrir · declarar consumo · fechar) |
| FS2 | FS2-10 | RPC `prod_registrar_refugo` |
| FS2 | FS2-11 | RPC `prod_estornar_movimento` |
| FS2 | FS2-12 | View `prod_vw_saldo_insumos` |
| FS2 | FS2-13 | `NOTIFY pgrst` + verificação final |

---

## §C — SQL da fase

### FS2-0 — Pré-voo (somente leitura)

```sql
-- (a) esperado: as 5 tabelas da FS1 presentes; NENHUMA das novas desta fase existindo ainda
select tablename from pg_tables where schemaname='public' and tablename like 'prod\_%' order by 1;

-- (b) esperado: 1 linha — sala PONTEIRAS ativa
select id, codigo, ativa from public.prod_salas where codigo='PONTEIRAS';

-- (c) esperado: 6 linhas (5 INSUMO + 1 PRODUTO)
select p.codigo_alvo, p.nome_curto, sp.papel
  from public.prod_sala_produtos sp
  join public.prod_produtos p on p.id = sp.produto_id
  join public.prod_salas s on s.id = sp.sala_id and s.codigo='PONTEIRAS'
 order by sp.papel, p.codigo_alvo;

-- (d) esperado: 7 permissões do módulo salas, SEM 'salas.batelada.manage'
select codigo from public.hub_permissions where modulo='salas' order by 1;
```

Qualquer divergência → **PARAR** e reportar.

> ⚠️ **A tabela legada `prod_motivos_refugo` (de teste) NÃO é tocada.** A tabela desta fase
> chama-se `prod_sala_motivos_refugo` — nome diferente, de propósito.

---

### FS2-1 — `prod_sala_motivos_refugo` + semeadura

```sql
create table public.prod_sala_motivos_refugo (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  aplica_a text not null check (aplica_a in ('INSUMO','PRODUTO','AMBOS')),
  ordem integer not null default 100,
  ativo boolean not null default true,
  provisorio boolean not null default false,
  criado_em timestamptz not null default now()
);
```

```sql
alter table public.prod_sala_motivos_refugo enable row level security;
```

```sql
create policy prod_sala_motivos_refugo_select on public.prod_sala_motivos_refugo
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));
```

```sql
-- 5 de peça pronta: definitivos (planilha do Pedro) · 6 de insumo: PROVISÓRIOS (validar com a sala)
insert into public.prod_sala_motivos_refugo (codigo, nome, aplica_a, ordem, provisorio) values
 ('FALHAS',              'Falhas',                     'PRODUTO', 10, false),
 ('REBARBA_PONTEIRA',    'Rebarbas na ponteira',       'PRODUTO', 20, false),
 ('PONTOS_PRETOS',       'Pontos pretos',              'PRODUTO', 30, false),
 ('EXCESSO_RASQUETE',    'Excesso de rasqueteamento',  'PRODUTO', 40, false),
 ('REBARBA_EXTENSOR',    'Rebarbas no extensor',       'PRODUTO', 50, false),
 ('SOBRA_MISTURA',       'Sobra de mistura curada',    'INSUMO', 110, true),
 ('CONTAMINADO',         'Material contaminado',       'INSUMO', 120, true),
 ('LOTE_VENCIDO_SALA',   'Lote vencido na sala',       'INSUMO', 130, true),
 ('PERDA_MANUSEIO',      'Perda no manuseio',          'INSUMO', 140, true),
 ('SOBRA_PESAGEM',       'Sobra de pesagem/mistura',   'INSUMO', 150, true),
 ('PECA_PERDIDA',        'Peça perdida no processo',   'INSUMO', 160, true);
```

---

### FS2-2 — `prod_salas`: coluna de prefixo de lote

> ALTER **aditivo** (ADD COLUMN), autorizado nesta fase. Nenhuma coluna é removida ou alterada.

```sql
alter table public.prod_salas add column prefixo_lote text;
```

```sql
update public.prod_salas set prefixo_lote = 'PT' where codigo = 'PONTEIRAS';
```

```sql
-- esperado: PONTEIRAS · PT
select codigo, prefixo_lote from public.prod_salas;
```

---

### FS2-3 — `prod_bateladas`

```sql
create table public.prod_bateladas (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.prod_salas(id),
  produto_id uuid not null references public.prod_produtos(id),
  numero text not null unique,
  status text not null default 'ABERTA' check (status in ('ABERTA','FECHADA','CANCELADA')),
  qtd_produzida numeric(14,4),
  observacao text,
  aberta_por uuid not null,
  aberta_em timestamptz not null default now(),
  fechada_por uuid,
  fechada_em timestamptz,
  cancelada_por uuid,
  cancelada_em timestamptz,
  motivo_cancelamento text
);
```

```sql
create index prod_bateladas_abertas_ix on public.prod_bateladas (sala_id, status);
```

```sql
alter table public.prod_bateladas enable row level security;
```

```sql
create policy prod_bateladas_select on public.prod_bateladas
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));
```

---

### FS2-4 — `prod_batelada_consumos`

```sql
create table public.prod_batelada_consumos (
  id uuid primary key default gen_random_uuid(),
  batelada_id uuid not null references public.prod_bateladas(id),
  produto_id uuid not null references public.prod_produtos(id),
  quantidade numeric(14,4) not null check (quantidade > 0),
  unidade text not null,
  quantidade_base numeric(14,4) not null check (quantidade_base > 0),
  fator_usado numeric(14,9) not null default 1,
  lote text,
  momento text not null default 'ABERTURA' check (momento in ('ABERTURA','FECHAMENTO')),
  observacao text,
  registrado_por uuid not null,
  registrado_em timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid,
  motivo_estorno text
);
```

```sql
create index prod_batelada_consumos_bat_ix on public.prod_batelada_consumos (batelada_id) where estornada_em is null;
```

```sql
alter table public.prod_batelada_consumos enable row level security;
```

```sql
create policy prod_batelada_consumos_select on public.prod_batelada_consumos
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));
```

---

### FS2-5 — `prod_saidas`

```sql
create table public.prod_saidas (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.prod_salas(id),
  batelada_id uuid not null references public.prod_bateladas(id),
  produto_id uuid not null references public.prod_produtos(id),
  quantidade numeric(14,4) not null check (quantidade > 0),
  unidade text not null,
  quantidade_base numeric(14,4) not null check (quantidade_base > 0),
  fator_usado numeric(14,9) not null default 1,
  lote_producao text not null,
  observacao text,
  registrado_por uuid not null,
  registrado_em timestamptz not null default now(),
  data_movimento timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid,
  motivo_estorno text
);
```

```sql
create index prod_saidas_sala_ix on public.prod_saidas (sala_id, produto_id) where estornada_em is null;
```

```sql
alter table public.prod_saidas enable row level security;
```

```sql
create policy prod_saidas_select on public.prod_saidas
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));
```

---

### FS2-6 — `prod_refugos`

```sql
create table public.prod_refugos (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.prod_salas(id),
  batelada_id uuid references public.prod_bateladas(id),
  produto_id uuid not null references public.prod_produtos(id),
  tipo_item text not null check (tipo_item in ('INSUMO','PRODUTO')),
  motivo_id uuid not null references public.prod_sala_motivos_refugo(id),
  quantidade numeric(14,4) not null check (quantidade > 0),
  unidade text not null,
  quantidade_base numeric(14,4) not null check (quantidade_base > 0),
  fator_usado numeric(14,9) not null default 1,
  lote text,
  observacao text,
  registrado_por uuid not null,
  registrado_em timestamptz not null default now(),
  data_movimento timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid,
  motivo_estorno text
);
```

```sql
create index prod_refugos_saldo_ix on public.prod_refugos (sala_id, produto_id, tipo_item) where estornada_em is null;
```

```sql
alter table public.prod_refugos enable row level security;
```

```sql
create policy prod_refugos_select on public.prod_refugos
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));
```

---

### FS2-7 — Permissão nova + mapeamentos

```sql
insert into public.hub_permissions (codigo, nome, descricao, modulo) values
 ('salas.batelada.manage', 'Gerir bateladas', 'Abrir, declarar consumo e fechar bateladas da sala', 'salas');
```

```sql
insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id from public.hub_roles r join public.hub_permissions p
  on p.codigo = 'salas.batelada.manage'
where r.codigo in ('operador_salas','gestor_salas','admin')
  and not exists (select 1 from public.hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);
```

```sql
-- esperado: 8 perms no módulo · gestor 8 · operador 5 · qualidade 3 · visualizador 2 · admin(salas) 8
select r.codigo, count(rp.id) as perms
  from public.hub_roles r
  left join public.hub_role_permissions rp on rp.role_id = r.id
  join public.hub_permissions p on p.id = rp.permission_id and p.modulo='salas'
 where r.codigo in ('operador_salas','qualidade_salas','gestor_salas','visualizador_salas','admin')
 group by r.codigo order by 1;
```

---

### FS2-8 — RPC `prod_registrar_entrada`

```sql
create or replace function public.prod_registrar_entrada(
  p_sala_id uuid, p_produto_id uuid, p_quantidade numeric, p_unidade text,
  p_lote text default null, p_validade date default null, p_nf_numero text default null,
  p_local_origem text default '001', p_observacao text default null,
  p_data_movimento timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_prod record; v_peso numeric; v_id uuid;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;
  if not public.user_has_sala_permission(v_uid, p_sala_id, 'salas.registrar.entrada') then
    raise exception 'Sem permissão para registrar entrada nesta sala';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida'; end if;

  select p.* into v_prod from public.prod_produtos p where p.id = p_produto_id and p.ativo;
  if not found then raise exception 'Produto inexistente ou inativo'; end if;

  if not exists (select 1 from public.prod_sala_produtos sp
                 where sp.sala_id = p_sala_id and sp.produto_id = p_produto_id and sp.papel = 'INSUMO') then
    raise exception 'Produto não é insumo desta sala';
  end if;

  select (u->>'peso')::numeric into v_peso
    from jsonb_array_elements(v_prod.escala_unidades) u where u->>'unidade' = p_unidade;
  if v_peso is null then raise exception 'Unidade % não existe na escala do produto', p_unidade; end if;

  if v_prod.controla_lote then
    if p_lote is null or btrim(p_lote) = '' then raise exception 'Lote obrigatório para este produto'; end if;
    if p_validade is null then raise exception 'Validade obrigatória para este produto'; end if;
    if p_validade < p_data_movimento::date then
      raise exception 'Lote % vencido em % — não pode entrar na sala', p_lote, to_char(p_validade,'DD/MM/YYYY');
    end if;
  end if;

  insert into public.prod_entradas
    (sala_id, produto_id, quantidade, unidade, quantidade_base, fator_usado, lote, validade_lote,
     nf_numero, local_origem, observacao, registrado_por, data_movimento)
  values
    (p_sala_id, p_produto_id, p_quantidade, p_unidade, p_quantidade * v_peso, v_peso,
     nullif(btrim(p_lote),''), p_validade, nullif(btrim(p_nf_numero),''), p_local_origem,
     nullif(btrim(p_observacao),''), v_uid, p_data_movimento)
  returning id into v_id;
  return v_id;
end;
$$;
```

```sql
revoke execute on function public.prod_registrar_entrada(uuid, uuid, numeric, text, text, date, text, text, text, timestamptz) from public;
revoke execute on function public.prod_registrar_entrada(uuid, uuid, numeric, text, text, date, text, text, text, timestamptz) from anon;
grant  execute on function public.prod_registrar_entrada(uuid, uuid, numeric, text, text, date, text, text, text, timestamptz) to authenticated;
```

---

### FS2-9 — RPCs de batelada

```sql
create or replace function public.prod_abrir_batelada(
  p_sala_id uuid, p_produto_id uuid, p_observacao text default null
) returns table (id uuid, numero text)
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_sala record; v_seq int; v_numero text; v_id uuid;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;
  if not public.user_has_sala_permission(v_uid, p_sala_id, 'salas.batelada.manage') then
    raise exception 'Sem permissão para gerir bateladas nesta sala';
  end if;

  select s.* into v_sala from public.prod_salas s where s.id = p_sala_id and s.ativa;
  if not found then raise exception 'Sala inexistente ou inativa'; end if;
  if v_sala.prefixo_lote is null then raise exception 'Sala sem prefixo de lote configurado'; end if;

  if not exists (select 1 from public.prod_sala_produtos sp
                 where sp.sala_id = p_sala_id and sp.produto_id = p_produto_id and sp.papel = 'PRODUTO') then
    raise exception 'Produto não é produto desta sala';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_sala_id::text || current_date::text));

  select coalesce(max(split_part(b.numero,'-',3)::int),0) + 1 into v_seq
    from public.prod_bateladas b
   where b.sala_id = p_sala_id and b.aberta_em::date = current_date;

  v_numero := v_sala.prefixo_lote || '-' || to_char(current_date,'YYMMDD') || '-' || lpad(v_seq::text,2,'0');

  insert into public.prod_bateladas (sala_id, produto_id, numero, observacao, aberta_por)
  values (p_sala_id, p_produto_id, v_numero, nullif(btrim(p_observacao),''), v_uid)
  returning prod_bateladas.id into v_id;

  return query select v_id, v_numero;
end;
$$;
```

```sql
create or replace function public.prod_declarar_consumo(
  p_batelada_id uuid, p_produto_id uuid, p_quantidade numeric, p_unidade text,
  p_lote text default null, p_momento text default 'ABERTURA', p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_bat record; v_prod record; v_peso numeric; v_id uuid;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;

  select b.* into v_bat from public.prod_bateladas b where b.id = p_batelada_id;
  if not found then raise exception 'Batelada inexistente'; end if;
  if v_bat.status <> 'ABERTA' then raise exception 'Batelada % não está aberta', v_bat.numero; end if;

  if not public.user_has_sala_permission(v_uid, v_bat.sala_id, 'salas.batelada.manage') then
    raise exception 'Sem permissão para gerir bateladas nesta sala';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida'; end if;

  select p.* into v_prod from public.prod_produtos p where p.id = p_produto_id and p.ativo;
  if not found then raise exception 'Produto inexistente ou inativo'; end if;

  if not exists (select 1 from public.prod_sala_produtos sp
                 where sp.sala_id = v_bat.sala_id and sp.produto_id = p_produto_id and sp.papel = 'INSUMO') then
    raise exception 'Produto não é insumo desta sala';
  end if;

  select (u->>'peso')::numeric into v_peso
    from jsonb_array_elements(v_prod.escala_unidades) u where u->>'unidade' = p_unidade;
  if v_peso is null then raise exception 'Unidade % não existe na escala do produto', p_unidade; end if;

  if v_prod.controla_lote and (p_lote is null or btrim(p_lote) = '') then
    raise exception 'Lote obrigatório para este produto';
  end if;

  insert into public.prod_batelada_consumos
    (batelada_id, produto_id, quantidade, unidade, quantidade_base, fator_usado, lote, momento, observacao, registrado_por)
  values
    (p_batelada_id, p_produto_id, p_quantidade, p_unidade, p_quantidade * v_peso, v_peso,
     nullif(btrim(p_lote),''), p_momento, nullif(btrim(p_observacao),''), v_uid)
  returning id into v_id;
  return v_id;
end;
$$;
```

```sql
create or replace function public.prod_fechar_batelada(
  p_batelada_id uuid, p_qtd_produzida numeric, p_observacao text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_bat record; v_prod record; v_peso numeric; v_saida uuid;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;

  select b.* into v_bat from public.prod_bateladas b where b.id = p_batelada_id;
  if not found then raise exception 'Batelada inexistente'; end if;
  if v_bat.status <> 'ABERTA' then raise exception 'Batelada % não está aberta', v_bat.numero; end if;

  if not public.user_has_sala_permission(v_uid, v_bat.sala_id, 'salas.batelada.manage') then
    raise exception 'Sem permissão para gerir bateladas nesta sala';
  end if;
  if p_qtd_produzida is null or p_qtd_produzida < 0 then raise exception 'Quantidade produzida inválida'; end if;

  if not exists (select 1 from public.prod_batelada_consumos c
                 where c.batelada_id = p_batelada_id and c.estornada_em is null) then
    raise exception 'Batelada sem consumo declarado — declare o consumo antes de fechar';
  end if;

  select p.* into v_prod from public.prod_produtos p where p.id = v_bat.produto_id;
  select (u->>'peso')::numeric into v_peso
    from jsonb_array_elements(v_prod.escala_unidades) u where u->>'unidade' = v_prod.unidade_base;
  v_peso := coalesce(v_peso, 1);

  if p_qtd_produzida > 0 then
    insert into public.prod_saidas
      (sala_id, batelada_id, produto_id, quantidade, unidade, quantidade_base, fator_usado,
       lote_producao, registrado_por)
    values
      (v_bat.sala_id, p_batelada_id, v_bat.produto_id, p_qtd_produzida, v_prod.unidade_base,
       p_qtd_produzida * v_peso, v_peso, v_bat.numero, v_uid)
    returning id into v_saida;
  end if;

  update public.prod_bateladas
     set status = 'FECHADA', qtd_produzida = p_qtd_produzida, fechada_em = now(), fechada_por = v_uid,
         observacao = coalesce(nullif(btrim(p_observacao),''), observacao)
   where id = p_batelada_id;

  return coalesce(v_saida, p_batelada_id);
end;
$$;
```

```sql
revoke execute on function public.prod_abrir_batelada(uuid, uuid, text) from public;
revoke execute on function public.prod_abrir_batelada(uuid, uuid, text) from anon;
grant  execute on function public.prod_abrir_batelada(uuid, uuid, text) to authenticated;

revoke execute on function public.prod_declarar_consumo(uuid, uuid, numeric, text, text, text, text) from public;
revoke execute on function public.prod_declarar_consumo(uuid, uuid, numeric, text, text, text, text) from anon;
grant  execute on function public.prod_declarar_consumo(uuid, uuid, numeric, text, text, text, text) to authenticated;

revoke execute on function public.prod_fechar_batelada(uuid, numeric, text) from public;
revoke execute on function public.prod_fechar_batelada(uuid, numeric, text) from anon;
grant  execute on function public.prod_fechar_batelada(uuid, numeric, text) to authenticated;
```

---

### FS2-10 — RPC `prod_registrar_refugo`

```sql
create or replace function public.prod_registrar_refugo(
  p_sala_id uuid, p_produto_id uuid, p_tipo_item text, p_motivo_id uuid,
  p_quantidade numeric, p_unidade text, p_lote text default null,
  p_batelada_id uuid default null, p_observacao text default null,
  p_data_movimento timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_prod record; v_mot record; v_peso numeric; v_papel text; v_id uuid;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;
  if not public.user_has_sala_permission(v_uid, p_sala_id, 'salas.registrar.refugo') then
    raise exception 'Sem permissão para registrar refugo nesta sala';
  end if;
  if p_tipo_item not in ('INSUMO','PRODUTO') then raise exception 'Tipo de item inválido'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida'; end if;

  select m.* into v_mot from public.prod_sala_motivos_refugo m where m.id = p_motivo_id and m.ativo;
  if not found then raise exception 'Motivo inexistente ou inativo'; end if;
  if v_mot.aplica_a <> 'AMBOS' and v_mot.aplica_a <> p_tipo_item then
    raise exception 'Motivo % não se aplica a %', v_mot.nome, p_tipo_item;
  end if;

  select p.* into v_prod from public.prod_produtos p where p.id = p_produto_id and p.ativo;
  if not found then raise exception 'Produto inexistente ou inativo'; end if;

  select sp.papel into v_papel from public.prod_sala_produtos sp
   where sp.sala_id = p_sala_id and sp.produto_id = p_produto_id;
  if v_papel is null then raise exception 'Produto não pertence a esta sala'; end if;
  if v_papel <> p_tipo_item then raise exception 'Produto é % nesta sala, não %', v_papel, p_tipo_item; end if;

  select (u->>'peso')::numeric into v_peso
    from jsonb_array_elements(v_prod.escala_unidades) u where u->>'unidade' = p_unidade;
  if v_peso is null then raise exception 'Unidade % não existe na escala do produto', p_unidade; end if;

  if p_batelada_id is not null then
    if not exists (select 1 from public.prod_bateladas b
                   where b.id = p_batelada_id and b.sala_id = p_sala_id and b.status = 'ABERTA') then
      raise exception 'Batelada inexistente, de outra sala, ou não está aberta';
    end if;
  end if;

  if v_prod.controla_lote and p_tipo_item = 'INSUMO' and (p_lote is null or btrim(p_lote) = '') then
    raise exception 'Lote obrigatório para refugo de insumo';
  end if;

  insert into public.prod_refugos
    (sala_id, batelada_id, produto_id, tipo_item, motivo_id, quantidade, unidade, quantidade_base,
     fator_usado, lote, observacao, registrado_por, data_movimento)
  values
    (p_sala_id, p_batelada_id, p_produto_id, p_tipo_item, p_motivo_id, p_quantidade, p_unidade,
     p_quantidade * v_peso, v_peso, nullif(btrim(p_lote),''), nullif(btrim(p_observacao),''),
     v_uid, p_data_movimento)
  returning id into v_id;
  return v_id;
end;
$$;
```

```sql
revoke execute on function public.prod_registrar_refugo(uuid, uuid, text, uuid, numeric, text, text, uuid, text, timestamptz) from public;
revoke execute on function public.prod_registrar_refugo(uuid, uuid, text, uuid, numeric, text, text, uuid, text, timestamptz) from anon;
grant  execute on function public.prod_registrar_refugo(uuid, uuid, text, uuid, numeric, text, text, uuid, text, timestamptz) to authenticated;
```

---

### FS2-11 — RPC `prod_estornar_movimento` (janela de 60 minutos)

```sql
create or replace function public.prod_estornar_movimento(
  p_tipo text, p_id uuid, p_motivo text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sala uuid; v_autor uuid; v_em timestamptz; v_estornada timestamptz;
  v_perm_registrar text; v_pode boolean;
begin
  if v_uid is null then raise exception 'Sessão não autenticada'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'Motivo do estorno é obrigatório'; end if;
  if p_tipo not in ('ENTRADA','REFUGO','SAIDA','CONSUMO') then raise exception 'Tipo inválido'; end if;

  if p_tipo = 'ENTRADA' then
    select e.sala_id, e.registrado_por, e.registrado_em, e.estornada_em
      into v_sala, v_autor, v_em, v_estornada from public.prod_entradas e where e.id = p_id;
    v_perm_registrar := 'salas.registrar.entrada';
  elsif p_tipo = 'REFUGO' then
    select r.sala_id, r.registrado_por, r.registrado_em, r.estornada_em
      into v_sala, v_autor, v_em, v_estornada from public.prod_refugos r where r.id = p_id;
    v_perm_registrar := 'salas.registrar.refugo';
  elsif p_tipo = 'SAIDA' then
    select s.sala_id, s.registrado_por, s.registrado_em, s.estornada_em
      into v_sala, v_autor, v_em, v_estornada from public.prod_saidas s where s.id = p_id;
    v_perm_registrar := 'salas.registrar.saida';
  else
    select b.sala_id, c.registrado_por, c.registrado_em, c.estornada_em
      into v_sala, v_autor, v_em, v_estornada
      from public.prod_batelada_consumos c join public.prod_bateladas b on b.id = c.batelada_id
     where c.id = p_id;
    v_perm_registrar := 'salas.batelada.manage';
  end if;

  if v_sala is null then raise exception 'Registro não encontrado'; end if;
  if v_estornada is not null then raise exception 'Registro já estornado'; end if;

  v_pode := public.user_has_sala_permission(v_uid, v_sala, 'salas.estornar')
         or ( v_autor = v_uid
              and now() - v_em < interval '60 minutes'
              and public.user_has_sala_permission(v_uid, v_sala, v_perm_registrar) );

  if not v_pode then
    raise exception 'Sem permissão para estornar: a janela de 60 minutos do autor expirou — peça ao gestor';
  end if;

  if p_tipo = 'ENTRADA' then
    update public.prod_entradas set estornada_em = now(), estornada_por = v_uid, motivo_estorno = p_motivo where id = p_id;
  elsif p_tipo = 'REFUGO' then
    update public.prod_refugos set estornada_em = now(), estornada_por = v_uid, motivo_estorno = p_motivo where id = p_id;
  elsif p_tipo = 'SAIDA' then
    update public.prod_saidas set estornada_em = now(), estornada_por = v_uid, motivo_estorno = p_motivo where id = p_id;
  else
    update public.prod_batelada_consumos set estornada_em = now(), estornada_por = v_uid, motivo_estorno = p_motivo where id = p_id;
  end if;

  return true;
end;
$$;
```

```sql
revoke execute on function public.prod_estornar_movimento(text, uuid, text) from public;
revoke execute on function public.prod_estornar_movimento(text, uuid, text) from anon;
grant  execute on function public.prod_estornar_movimento(text, uuid, text) to authenticated;
```

---

### FS2-12 — View de saldo de insumos

```sql
create view public.prod_vw_saldo_insumos
with (security_invoker = true) as
with mov as (
  select e.sala_id, e.produto_id, e.lote, e.quantidade_base as qtd
    from public.prod_entradas e where e.estornada_em is null
  union all
  select b.sala_id, c.produto_id, c.lote, -c.quantidade_base
    from public.prod_batelada_consumos c
    join public.prod_bateladas b on b.id = c.batelada_id
   where c.estornada_em is null and b.status <> 'CANCELADA'
  union all
  select r.sala_id, r.produto_id, r.lote, -r.quantidade_base
    from public.prod_refugos r
   where r.estornada_em is null and r.tipo_item = 'INSUMO'
)
select m.sala_id, s.codigo as sala, m.produto_id, p.nome_curto, p.unidade_base,
       m.lote, sum(m.qtd) as saldo_base
  from mov m
  join public.prod_salas s on s.id = m.sala_id
  join public.prod_produtos p on p.id = m.produto_id
 group by m.sala_id, s.codigo, m.produto_id, p.nome_curto, p.unidade_base, m.lote
having sum(m.qtd) <> 0;
```

---

### FS2-13 — Fechamento

```sql
NOTIFY pgrst, 'reload schema';
```

```sql
-- (1) esperado: 11 motivos (5 PRODUTO definitivos + 6 INSUMO provisórios)
select aplica_a, count(*) filter (where provisorio) as provisorios, count(*) as total
  from public.prod_sala_motivos_refugo group by aplica_a order by 1;

-- (2) esperado: 8 permissões no módulo salas
select count(*) from public.hub_permissions where modulo='salas';

-- (3) esperado: as 5 tabelas novas desta fase, todas com rowsecurity = true
select tablename, rowsecurity from pg_tables
 where schemaname='public'
   and tablename in ('prod_sala_motivos_refugo','prod_bateladas','prod_batelada_consumos','prod_saidas','prod_refugos')
 order by 1;

-- (4) esperado: NENHUMA policy de INSERT/UPDATE/DELETE nas tabelas do módulo (só SELECT)
select tablename, policyname, cmd from pg_policies
 where schemaname='public' and tablename like 'prod\_%' order by 1, 3;

-- (5) esperado: 6 funções novas, proacl SEM anon em todas
select proname, pg_get_function_identity_arguments(oid) as args, proacl
  from pg_proc
 where proname in ('prod_registrar_entrada','prod_abrir_batelada','prod_declarar_consumo',
                   'prod_fechar_batelada','prod_registrar_refugo','prod_estornar_movimento')
 order by proname;

-- (6) esperado: view existe e retorna 0 linhas (nenhum movimento ainda)
select count(*) from public.prod_vw_saldo_insumos;
```

---

## §D — Como testar (importante para o agente)

⚠️ **Nenhuma RPC desta fase pode ser testada pelo MCP.** Todas abrem com
`if v_uid is null then raise exception 'Sessão não autenticada'` e a conexão do MCP é não
autenticada (`auth.uid()` = NULL) — a mesma limitação que gerou o Ajuste A na FS1.

**Isto é comportamento correto, não falha.** O agente deve:

1. Verificar **apenas a estrutura** (as 6 consultas da FS2-13).
2. **Não** tentar chamar as RPCs para "ver se funcionam".
3. **Não** contornar criando usuário fake, alterando as funções ou removendo a checagem.

O teste funcional é humano, pela UI, na FS3 — ou pelo Pedro via console do navegador com sessão
real (mesmo método do Lab de API). Roteiro sugerido para esse teste:

- abrir batelada → declarar consumo de silicone e bário → registrar refugo de peça → fechar com
  quantidade boa → conferir `prod_vw_saldo_insumos`;
- tentar entrada com lote vencido → deve falhar com a mensagem de bloqueio;
- estornar registro próprio dentro de 60 min (deve passar) e depois da janela (deve exigir gestor).

---

## §E — Critério de aceite da FS2

As 6 verificações da FS2-13 batendo com o esperado, DIARIO completo com uma entrada por tarefa,
Quadro de Status atualizado, commits por tarefa e push feito.

## §F — Pendências que esta fase deixa aberta (para o Pedro, não para o agente)

1. **Validar os 6 motivos de insumo** com a sala (estão marcados `provisorio = true`). Ajuste é
   por UPDATE, sem DDL.
2. **Decidir o momento do consumo** (ABERTURA vs FECHAMENTO) — o banco aceita os dois; é decisão
   de UI na FS3.
3. **Peça pronta não fica em saldo na sala** (§A.2). Revisar se a prática for outra.
4. **Nada é escrito no Alvo ERP** — segue valendo o MVP 100% Hub.
