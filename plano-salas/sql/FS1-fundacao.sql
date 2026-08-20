-- ============================================================================
-- FS1 — FUNDAÇÃO · Movimentação de Salas · Financial Hub P&F Brasil
-- Projeto Supabase: hbtggrbauguukewiknew
-- Execução: statement a statement, na ordem, via MCP (apply_migration p/ DDL,
--           execute_sql p/ verificações). SEM BEGIN/COMMIT manuais.
-- Regra: verificação divergente do esperado => PARAR e reportar (PLANO §1.1).
-- ============================================================================

-- ============================================================================
-- FS1-0 — PRÉ-VOO (somente leitura)
-- ============================================================================

-- (a) Esperado: EXATAMENTE prod_apontamento_motivos, prod_apontamentos,
--     prod_atividades, prod_itens, prod_motivos_refugo (a view antiga não
--     aparece em pg_tables). Qualquer outra prod_* => PARAR.
select tablename from pg_tables
where schemaname='public' and tablename like 'prod\_%' order by 1;

-- (b) Esperado: 0 linhas nas duas consultas.
select codigo from public.hub_permissions where codigo like 'salas.%';
select codigo from public.hub_roles
where codigo in ('operador_salas','qualidade_salas','gestor_salas','visualizador_salas');

-- (c) Esperado: as 3 tabelas com coluna id e column_default de uuid
--     (gen_random_uuid() ou uuid_generate_v4()). Sem default => PARAR.
select table_name, column_name, column_default from information_schema.columns
where table_name in ('hub_permissions','hub_roles','hub_role_permissions')
  and column_name='id';

-- ============================================================================
-- FS1-0b — CANÁRIO DE ESCRITA (única exceção de DROP autorizada no projeto,
--          restrita a este nome exato)
-- ============================================================================
create table public.prod_zz_agent_canary (id int primary key, nota text);
insert into public.prod_zz_agent_canary values (1, 'mcp write ok');
select * from public.prod_zz_agent_canary;            -- esperado: 1 linha
drop table public.prod_zz_agent_canary;

-- ============================================================================
-- FS1-1 — prod_salas
-- ============================================================================
create table public.prod_salas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  descricao text,
  tipo_producao text not null check (tipo_producao in ('CATETER','VALVULA','ENCAPSULAMENTO')),
  ativa boolean not null default true,
  criado_por uuid not null default auth.uid(),
  criado_em timestamptz not null default now()
);

alter table public.prod_salas enable row level security;

create policy prod_salas_select on public.prod_salas
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));

-- ============================================================================
-- FS1-2 — prod_produtos
-- ============================================================================
create table public.prod_produtos (
  id uuid primary key default gen_random_uuid(),
  codigo_alvo text not null unique,
  alternativo text,
  nome text not null,
  nome_curto text,
  unidade_base text not null,
  escala_unidades jsonb not null default '[]'::jsonb,
  controla_lote boolean not null default false,
  permite_lote_vencido boolean not null default false,
  gera_lote_automatico boolean not null default false,
  ativo boolean not null default true,
  raw jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.prod_produtos enable row level security;

create policy prod_produtos_select on public.prod_produtos
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));

-- ============================================================================
-- FS1-3 — prod_sala_produtos
-- ============================================================================
create table public.prod_sala_produtos (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.prod_salas(id),
  produto_id uuid not null references public.prod_produtos(id),
  papel text not null check (papel in ('INSUMO','PRODUTO')),
  criado_em timestamptz not null default now(),
  unique (sala_id, produto_id)
);

alter table public.prod_sala_produtos enable row level security;

create policy prod_sala_produtos_select on public.prod_sala_produtos
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));

-- ============================================================================
-- FS1-4 — prod_sala_usuarios (vínculo pessoa↔sala; user_id = profiles.user_id)
-- ============================================================================
create table public.prod_sala_usuarios (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.prod_salas(id),
  user_id uuid not null,
  atribuido_por uuid not null default auth.uid(),
  atribuido_em timestamptz not null default now(),
  revogado_por uuid,
  revogado_em timestamptz,
  motivo text
);

create unique index prod_sala_usuarios_ativo_uq
  on public.prod_sala_usuarios (sala_id, user_id)
  where revogado_em is null;

alter table public.prod_sala_usuarios enable row level security;

create policy prod_sala_usuarios_select on public.prod_sala_usuarios
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));

-- ============================================================================
-- FS1-5 — prod_entradas (o livro; validações de negócio ficam na RPC da FS2)
-- ============================================================================
create table public.prod_entradas (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.prod_salas(id),
  produto_id uuid not null references public.prod_produtos(id),
  quantidade numeric(14,4) not null check (quantidade > 0),
  unidade text not null,
  quantidade_base numeric(14,4) not null check (quantidade_base > 0),
  fator_usado numeric(14,9) not null default 1,
  lote text,
  validade_lote date,
  nf_numero text,
  chave_movestq bigint,
  seq_item_movestq integer,
  local_origem text default '001',
  observacao text,
  registrado_por uuid not null,
  registrado_em timestamptz not null default now(),
  data_movimento timestamptz not null default now(),
  estornada_em timestamptz,
  estornada_por uuid,
  motivo_estorno text
);

create index prod_entradas_saldo_ix
  on public.prod_entradas (sala_id, produto_id) where estornada_em is null;

create index prod_entradas_registrado_ix on public.prod_entradas (registrado_em);

alter table public.prod_entradas enable row level security;

create policy prod_entradas_select on public.prod_entradas
  for select to authenticated
  using (public.user_has_permission(auth.uid(), 'salas.access'));

-- ============================================================================
-- FS1-6 — RBAC: 7 permissões, 4 papéis, mapeamentos (incluindo admin)
-- ============================================================================
insert into public.hub_permissions (codigo, nome, descricao, modulo) values
 ('salas.access',            'Acessar Movimentação de Salas', 'Ver o menu e entrar no módulo', 'salas'),
 ('salas.registrar.entrada', 'Registrar entrada',             'Registrar entrada de insumo na sala', 'salas'),
 ('salas.registrar.saida',   'Registrar saída',               'Registrar saída de produto da sala', 'salas'),
 ('salas.registrar.refugo',  'Registrar refugo',              'Registrar refugo/descarte na sala', 'salas'),
 ('salas.estornar',          'Estornar registro',             'Estornar (soft) um registro de movimentação', 'salas'),
 ('salas.dashboard.view',    'Ver dashboards',                'Dashboards analíticos de salas', 'salas'),
 ('salas.cadastros.manage',  'Gerir cadastros',               'Salas, vínculos de produtos, equipe e motivos', 'salas');

insert into public.hub_roles (codigo, nome, descricao, modulo, is_system) values
 ('operador_salas',      'Operador de Salas',      'Registra entrada, saída e refugo nas salas vinculadas', 'salas', false),
 ('qualidade_salas',     'Qualidade — Salas',      'Registra refugo e acompanha dashboards', 'salas', false),
 ('gestor_salas',        'Gestor de Salas',        'Acesso completo ao módulo, inclusive estorno e cadastros', 'salas', false),
 ('visualizador_salas',  'Visualizador de Salas',  'Leitura: acesso e dashboards', 'salas', false);

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id from public.hub_roles r join public.hub_permissions p
  on p.codigo in ('salas.access','salas.registrar.entrada','salas.registrar.saida','salas.registrar.refugo')
where r.codigo = 'operador_salas'
  and not exists (select 1 from public.hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id from public.hub_roles r join public.hub_permissions p
  on p.codigo in ('salas.access','salas.registrar.refugo','salas.dashboard.view')
where r.codigo = 'qualidade_salas'
  and not exists (select 1 from public.hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id from public.hub_roles r join public.hub_permissions p on p.modulo = 'salas'
where r.codigo = 'gestor_salas'
  and not exists (select 1 from public.hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id from public.hub_roles r join public.hub_permissions p
  on p.codigo in ('salas.access','salas.dashboard.view')
where r.codigo = 'visualizador_salas'
  and not exists (select 1 from public.hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

-- a lição do 42/55: admin recebe as 7 no mesmo script
insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id from public.hub_roles r join public.hub_permissions p on p.modulo = 'salas'
where r.codigo = 'admin'
  and not exists (select 1 from public.hub_role_permissions x where x.role_id=r.id and x.permission_id=p.id);

-- ============================================================================
-- FS1-7 — user_has_sala_permission (papel dá o verbo, vínculo dá o lugar)
-- ============================================================================
create or replace function public.user_has_sala_permission(p_user_id uuid, p_sala_id uuid, p_permission_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select pr.is_admin from public.profiles pr where pr.user_id = p_user_id limit 1), false)
    or (
      public.user_has_permission(p_user_id, p_permission_code)
      and exists (
        select 1 from public.prod_sala_usuarios su
        where su.sala_id = p_sala_id
          and su.user_id = p_user_id
          and su.revogado_em is null
      )
    );
$$;

revoke execute on function public.user_has_sala_permission(uuid, uuid, text) from public;
revoke execute on function public.user_has_sala_permission(uuid, uuid, text) from anon;
grant  execute on function public.user_has_sala_permission(uuid, uuid, text) to authenticated;

-- ============================================================================
-- FS1-8 — RPCs de vínculo de equipe
-- ============================================================================
create or replace function public.prod_sala_usuario_vincular(p_sala_id uuid, p_user_id uuid, p_motivo text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.user_has_permission(auth.uid(), 'salas.cadastros.manage') then
    raise exception 'Sem permissão salas.cadastros.manage';
  end if;
  if not exists (select 1 from public.prod_salas s where s.id = p_sala_id and s.ativa) then
    raise exception 'Sala inexistente ou inativa';
  end if;
  if exists (select 1 from public.prod_sala_usuarios su
             where su.sala_id = p_sala_id and su.user_id = p_user_id and su.revogado_em is null) then
    raise exception 'Usuário já vinculado a esta sala';
  end if;
  insert into public.prod_sala_usuarios (sala_id, user_id, atribuido_por, motivo)
  values (p_sala_id, p_user_id, auth.uid(), p_motivo)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.prod_sala_usuario_revogar(p_sala_id uuid, p_user_id uuid, p_motivo text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_has_permission(auth.uid(), 'salas.cadastros.manage') then
    raise exception 'Sem permissão salas.cadastros.manage';
  end if;
  update public.prod_sala_usuarios
     set revogado_em = now(), revogado_por = auth.uid(),
         motivo = coalesce(p_motivo, motivo)
   where sala_id = p_sala_id and user_id = p_user_id and revogado_em is null;
  if not found then
    raise exception 'Vínculo ativo não encontrado';
  end if;
  return true;
end;
$$;

revoke execute on function public.prod_sala_usuario_vincular(uuid, uuid, text) from public;
revoke execute on function public.prod_sala_usuario_vincular(uuid, uuid, text) from anon;
grant  execute on function public.prod_sala_usuario_vincular(uuid, uuid, text) to authenticated;

revoke execute on function public.prod_sala_usuario_revogar(uuid, uuid, text) from public;
revoke execute on function public.prod_sala_usuario_revogar(uuid, uuid, text) from anon;
grant  execute on function public.prod_sala_usuario_revogar(uuid, uuid, text) to authenticated;

-- ============================================================================
-- FS1-9 — Semeadura do piloto (dados reais dos Produto/Load de 20/08/2026;
--          escala KG do Tensionador excluída DE PROPÓSITO — cadastro invertido no ERP)
-- ============================================================================
insert into public.prod_salas (codigo, nome, descricao, tipo_producao)
values ('PONTEIRAS', 'Sala de Produção de Ponteiras',
        'Piloto do módulo de Movimentação de Salas — linha Cateter (aórtica)', 'CATETER');

insert into public.prod_produtos
 (codigo_alvo, alternativo, nome, nome_curto, unidade_base, escala_unidades, controla_lote, permite_lote_vencido, gera_lote_automatico) values
 ('001.007.00037','810017','SILICONE ELASTOMER - MED-4080 A/B','Silicone','GRAMAS',
  '[{"unidade":"GRAMAS","posicao":1,"peso":1},{"unidade":"KG","posicao":2,"peso":1000},{"unidade":"UNID","posicao":3,"peso":4540}]'::jsonb,
  true,false,true),
 ('001.007.00004','810021','BARIUM SULFATE SILICONE MASTERBATCH - MED2-4102','Sulfato de Bário','GRAMAS',
  '[{"unidade":"GRAMAS","posicao":1,"peso":1},{"unidade":"KG","posicao":2,"peso":1000},{"unidade":"UNID","posicao":3,"peso":450}]'::jsonb,
  true,false,true),
 ('001.007.00025','810020','TENSIONER - STAINLESS STEEL - AISI 304 - TDS-001024','Tensionador','UNID',
  '[{"unidade":"UNID","posicao":1,"peso":1}]'::jsonb,
  true,false,true),
 ('001.007.00033','810086','POLYAMIDE TUBE 390-VII CMP/PI/BRD/4AXL/PI - PROFEAA003','Tubo de Passagem','UNID',
  '[{"unidade":"UNID","posicao":1,"peso":1}]'::jsonb,
  true,false,true),
 ('001.007.00012','810076','HOLDER - TDS-001044','Holder','UNID',
  '[{"unidade":"UNID","posicao":1,"peso":1}]'::jsonb,
  true,false,true),
 ('001.007.00065','810731','SUB ASSEMBLY A - PRO-002M08 PONTEIRA DE SILICONE COM TUBO PASSANTE - AORTIC VALVE','Ponteira + Tubo Passante (Sub Assembly A)','UNID',
  '[{"unidade":"UNID","posicao":1,"peso":1}]'::jsonb,
  true,false,true);

insert into public.prod_sala_produtos (sala_id, produto_id, papel)
select s.id, p.id,
       case when p.codigo_alvo = '001.007.00065' then 'PRODUTO' else 'INSUMO' end
from public.prod_salas s
join public.prod_produtos p on p.codigo_alvo in
 ('001.007.00037','001.007.00004','001.007.00025','001.007.00033','001.007.00012','001.007.00065')
where s.codigo = 'PONTEIRAS';

-- ============================================================================
-- FS1-10 — Reload do PostgREST + verificação final
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- esperado: 7 linhas
select codigo from public.hub_permissions where modulo='salas' order by 1;

-- esperado: gestor_salas 7 · operador_salas 4 · qualidade_salas 3 · visualizador_salas 2
select r.codigo, count(rp.id) as perms
  from public.hub_roles r
  left join public.hub_role_permissions rp on rp.role_id = r.id
 where r.modulo = 'salas'
 group by r.codigo order by 1;

-- esperado: 7
select count(*) as admin_salas
  from public.hub_role_permissions rp
  join public.hub_roles r on r.id = rp.role_id and r.codigo = 'admin'
  join public.hub_permissions p on p.id = rp.permission_id and p.modulo = 'salas';

-- esperado: PONTEIRAS · 5 · 1
select s.codigo,
       count(*) filter (where sp.papel='INSUMO')  as insumos,
       count(*) filter (where sp.papel='PRODUTO') as produtos
  from public.prod_salas s
  join public.prod_sala_produtos sp on sp.sala_id = s.id
 group by s.codigo;

-- esperado: 3 funções, proacl SEM anon
select proname, pg_get_function_identity_arguments(oid) as args, proacl
  from pg_proc
 where proname in ('user_has_sala_permission','prod_sala_usuario_vincular','prod_sala_usuario_revogar');
