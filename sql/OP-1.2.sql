-- =====================================================================
-- OP-1.2 · Módulo Ordem de Produção · Fase 1 · SQL Editor (hbtggrbauguukewiknew)
-- RLS (SELECT gateado) + RPCs de escrita SECURITY DEFINER + permissões/papéis
-- + lockdown de op_proximo_numero. Depende da OP-1.1 (já aplicada e verificada).
--
-- PROTOCOLO: este arquivo é a FONTE CANÔNICA do bloco. Copiar DAQUI (do arquivo),
-- nunca do terminal/chat — o display colapsa linhas longas e corrompe o SQL.
--
-- Schema RBAC/tabela lido ao vivo (23/07/2026), NÃO assumido:
--   hub_permissions(id, codigo UNIQUE, nome, descricao, modulo, created_at)
--   hub_roles(id, codigo UNIQUE, nome, descricao, modulo NOT NULL, is_system default false, ...)
--   hub_role_permissions(id, role_id, permission_id, created_at) UNIQUE(role_id, permission_id) -- liga por UUID
--   gate RPC: _user_has_perm(p_codigo) [STABLE, usa auth.uid()] · RLS: user_has_permission(uid, code)
--   op_ordens = 28 colunas (SEM fechada_por/fechada_em na OP-1.1 → adicionadas na seção 0 abaixo).
-- Tudo idempotente (add column if not exists / ON CONFLICT / create or replace / drop policy if exists).
--
-- ---- Mudanças da REVISÃO v2 (23/07/2026) ----------------------------
--  0) NOVO: op_ordens ganha fechada_por/fechada_em (não existiam; FECHADA precisa carimbá-las).
--  1) op_transicao_status: ramo p_para='FECHADA' carimba fechada_por/fechada_em (antes caía no else).
--  2) NOVAS RPCs (gate producao.ordens.manage): op_registrar_aprovacao, op_registrar_comunicacao.
--  3) Policies de SELECT com gate em subselect ((select user_has_permission(...))) → initplan 1x/consulta.
--  4) op_numeracao SEM policy (deny-all; RLS segue habilitada) — nenhuma tela lê o contador.
--  5) Verificação: has_function_privilege (lockdown/grants), contagem de policies=4, def de _user_has_perm.
-- =====================================================================

-- =====================================================================
-- 0) AJUSTE DE ESTRUTURA — colunas de fechamento (aditivo, nullable, reversível)
--    ⚠️ fechada_por/fechada_em NÃO existiam após a OP-1.1 (op_ordens tinha 28 col).
--    op_ordens tem 0 registros; adição é segura. Rollback: drop column (no fim).
-- =====================================================================
alter table public.op_ordens add column if not exists fechada_por uuid;
alter table public.op_ordens add column if not exists fechada_em  timestamptz;

-- =====================================================================
-- 1) CATÁLOGO DE PERMISSÕES (módulo 'producao') — descrições no padrão da casa
-- =====================================================================
insert into public.hub_permissions (codigo, nome, descricao, modulo) values
  ('producao.access',        'Acessar Produção',           'Acessar o módulo de Ordens de Produção (lista + detalhe).',                         'producao'),
  ('producao.ordens.create', 'Criar Ordem de Produção',    'Criar e editar Ordem de Produção em rascunho e abri-la (RASCUNHO -> ABERTA).',      'producao'),
  ('producao.ordens.manage', 'Gerir Ordens de Produção',   'Cancelar OP (com motivo), avançar/fechar/reabrir e editar dados de aprovação/comunicação.', 'producao')
on conflict (codigo) do nothing;

-- =====================================================================
-- 2) PAPÉIS (hub_roles) — is_system=false, módulo 'producao'
--    operador_producao: access + create · gestor_producao: access + create + manage
-- =====================================================================
insert into public.hub_roles (codigo, nome, descricao, modulo, is_system) values
  ('operador_producao', 'Operador de Produção',
     'Cria e abre Ordens de Produção (rascunho e abertura). Sem cancelar nem editar aprovação/comunicação.',
     'producao', false),
  ('gestor_producao',   'Gestor de Produção',
     'Acesso completo às Ordens de Produção: criar, abrir, cancelar (com motivo) e gerir aprovação/comunicação.',
     'producao', false)
on conflict (codigo) do nothing;

-- =====================================================================
-- 3) WIRING papel -> permissão (resolve codigo -> id; UNIQUE(role_id,permission_id))
-- =====================================================================
insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id
from public.hub_roles r
join public.hub_permissions p on true
where (r.codigo, p.codigo) in (
  ('operador_producao', 'producao.access'),
  ('operador_producao', 'producao.ordens.create'),
  ('gestor_producao',   'producao.access'),
  ('gestor_producao',   'producao.ordens.create'),
  ('gestor_producao',   'producao.ordens.manage')
)
on conflict (role_id, permission_id) do nothing;

-- =====================================================================
-- 4) RLS · SELECT gateado por producao.access. Gate em subselect → o planner
--    avalia como InitPlan 1x por consulta (não 1x por linha). SEM policy de
--    escrita: escrita só via RPCs SECURITY DEFINER (item 5). RLS já ligada (OP-1.1).
--    op_numeracao: SEM policy de propósito (deny-all) — nenhuma tela lê o contador;
--    as RPCs o acessam por dentro do definer. RLS permanece habilitada nela.
-- =====================================================================
drop policy if exists op_tipos_select            on public.op_tipos;
drop policy if exists op_ordens_select           on public.op_ordens;
drop policy if exists op_ordem_itens_select      on public.op_ordem_itens;
drop policy if exists op_numeracao_select        on public.op_numeracao;   -- removida no v2 (deny-all)
drop policy if exists op_status_historico_select on public.op_status_historico;

create policy op_tipos_select on public.op_tipos
  for select to authenticated
  using ((select public.user_has_permission(auth.uid(), 'producao.access')));

create policy op_ordens_select on public.op_ordens
  for select to authenticated
  using ((select public.user_has_permission(auth.uid(), 'producao.access')));

create policy op_ordem_itens_select on public.op_ordem_itens
  for select to authenticated
  using ((select public.user_has_permission(auth.uid(), 'producao.access')));

create policy op_status_historico_select on public.op_status_historico
  for select to authenticated
  using ((select public.user_has_permission(auth.uid(), 'producao.access')));

-- op_numeracao: intencionalmente SEM policy (deny-all). RLS segue habilitada da OP-1.1.

-- =====================================================================
-- 5) RPCs DE ESCRITA (SECURITY DEFINER + search_path + gate explícito)
-- =====================================================================

-- 5.1 op_criar_ordem: gera número, insere ordem RASCUNHO + itens, histórico NULL->RASCUNHO
create or replace function public.op_criar_ordem(p_dados jsonb, p_itens jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_op_id uuid;
  v_numero text;
begin
  if not public._user_has_perm('producao.ordens.create') then
    raise exception 'Sem permissão para criar Ordem de Produção (producao.ordens.create).'
      using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) < 1 then
    raise exception 'A Ordem de Produção exige ao menos 1 item.' using errcode = '22023';
  end if;
  if p_dados->>'tipo_id' is null then
    raise exception 'tipo_id é obrigatório.' using errcode = '22023';
  end if;

  v_numero := public.op_proximo_numero();

  insert into public.op_ordens (
    numero, numero_referencia, tipo_id, produto_familia,
    tipo_ordem, tipo_produto, destino, lote,
    data_inicio, data_fim_planejada, status, observacoes,
    emitido_por, emitido_depto, emitido_em
  ) values (
    v_numero,
    nullif(p_dados->>'numero_referencia',''),
    (p_dados->>'tipo_id')::uuid,
    nullif(p_dados->>'produto_familia',''),
    p_dados->>'tipo_ordem',
    p_dados->>'tipo_produto',
    p_dados->>'destino',
    nullif(p_dados->>'lote',''),
    nullif(p_dados->>'data_inicio','')::date,
    nullif(p_dados->>'data_fim_planejada','')::date,
    'RASCUNHO',
    nullif(p_dados->>'observacoes',''),
    v_uid,
    nullif(p_dados->>'emitido_depto',''),
    now()
  )
  returning id into v_op_id;

  insert into public.op_ordem_itens (
    op_id, sequencia, codigo_produto, codigo_alternativo_produto,
    produto_nome, produto_unidade, quantidade_planejada
  )
  select v_op_id,
         row_number() over (order by ord),
         item->>'codigo_produto',
         nullif(item->>'codigo_alternativo_produto',''),
         item->>'produto_nome',
         nullif(item->>'produto_unidade',''),
         (item->>'quantidade_planejada')::numeric
  from jsonb_array_elements(p_itens) with ordinality as t(item, ord);

  insert into public.op_status_historico (op_id, de, para, motivo, usuario)
  values (v_op_id, null, 'RASCUNHO', null, v_uid);

  return v_op_id;
end $$;

-- 5.2 op_atualizar_rascunho: só em status RASCUNHO; substitui cabeçalho + itens
create or replace function public.op_atualizar_rascunho(p_op_id uuid, p_dados jsonb, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public._user_has_perm('producao.ordens.create') then
    raise exception 'Sem permissão para editar rascunho (producao.ordens.create).' using errcode = '42501';
  end if;

  select status into v_status from public.op_ordens where id = p_op_id for update;
  if not found then
    raise exception 'Ordem de Produção % não encontrada.', p_op_id using errcode = 'P0002';
  end if;
  if v_status <> 'RASCUNHO' then
    raise exception 'Só é possível editar OP em RASCUNHO (status atual: %).', v_status using errcode = '22023';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) < 1 then
    raise exception 'A Ordem de Produção exige ao menos 1 item.' using errcode = '22023';
  end if;

  update public.op_ordens set
    numero_referencia  = nullif(p_dados->>'numero_referencia',''),
    tipo_id            = coalesce((p_dados->>'tipo_id')::uuid, tipo_id),
    produto_familia    = nullif(p_dados->>'produto_familia',''),
    tipo_ordem         = coalesce(p_dados->>'tipo_ordem', tipo_ordem),
    tipo_produto       = coalesce(p_dados->>'tipo_produto', tipo_produto),
    destino            = coalesce(p_dados->>'destino', destino),
    lote               = nullif(p_dados->>'lote',''),
    data_inicio        = nullif(p_dados->>'data_inicio','')::date,
    data_fim_planejada = nullif(p_dados->>'data_fim_planejada','')::date,
    observacoes        = nullif(p_dados->>'observacoes',''),
    emitido_depto      = nullif(p_dados->>'emitido_depto','')
  where id = p_op_id;
  -- numero, emitido_por, emitido_em: imutáveis. updated_at: via trigger.

  delete from public.op_ordem_itens where op_id = p_op_id;
  insert into public.op_ordem_itens (
    op_id, sequencia, codigo_produto, codigo_alternativo_produto,
    produto_nome, produto_unidade, quantidade_planejada
  )
  select p_op_id,
         row_number() over (order by ord),
         item->>'codigo_produto',
         nullif(item->>'codigo_alternativo_produto',''),
         item->>'produto_nome',
         nullif(item->>'produto_unidade',''),
         (item->>'quantidade_planejada')::numeric
  from jsonb_array_elements(p_itens) with ordinality as t(item, ord);
end $$;

-- 5.3 op_transicao_status: valida o mapa (seção 1 do PLANO-OP.md), gate por ação,
--     motivo obrigatório em cancelamento, carimba cancelada_* / fechada_*, grava histórico
create or replace function public.op_transicao_status(p_op_id uuid, p_para text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_de  text;
  v_requer_manage boolean;
begin
  select status into v_de from public.op_ordens where id = p_op_id for update;
  if not found then
    raise exception 'Ordem de Produção % não encontrada.', p_op_id using errcode = 'P0002';
  end if;

  -- Mapa de transições permitidas (seção 1 do plano)
  if (v_de, p_para) not in (
       ('RASCUNHO','ABERTA'), ('RASCUNHO','CANCELADA'),
       ('ABERTA','EM_ANDAMENTO'), ('ABERTA','CANCELADA'),
       ('EM_ANDAMENTO','EM_FECHAMENTO'), ('EM_ANDAMENTO','CANCELADA'),
       ('EM_FECHAMENTO','EM_ANDAMENTO'), ('EM_FECHAMENTO','FECHADA')
     ) then
    raise exception 'Transição de status inválida: % -> %.', v_de, p_para using errcode = '22023';
  end if;

  -- Gate por ação: avanço operacional (abrir / iniciar) = create;
  -- governança (cancelar / avançar p/ fechamento / fechar / reabrir) = manage.
  v_requer_manage := (v_de, p_para) not in (('RASCUNHO','ABERTA'), ('ABERTA','EM_ANDAMENTO'));
  if v_requer_manage then
    if not public._user_has_perm('producao.ordens.manage') then
      raise exception 'Sem permissão para esta transição (producao.ordens.manage).' using errcode = '42501';
    end if;
  else
    if not public._user_has_perm('producao.ordens.create') then
      raise exception 'Sem permissão para esta transição (producao.ordens.create).' using errcode = '42501';
    end if;
  end if;

  if p_para = 'CANCELADA' then
    if p_motivo is null or btrim(p_motivo) = '' then
      raise exception 'Cancelamento exige motivo.' using errcode = '22023';
    end if;
    update public.op_ordens
      set status = 'CANCELADA',
          cancelada_por = v_uid,
          cancelada_em = now(),
          motivo_cancelamento = p_motivo
      where id = p_op_id;
  elsif p_para = 'FECHADA' then
    update public.op_ordens
      set status = 'FECHADA',
          fechada_por = v_uid,
          fechada_em = now()
      where id = p_op_id;
  else
    update public.op_ordens set status = p_para where id = p_op_id;
  end if;

  insert into public.op_status_historico (op_id, de, para, motivo, usuario)
  values (p_op_id, v_de, p_para, p_motivo, v_uid);
end $$;

-- 5.4 op_registrar_aprovacao: carimba aprovado_* (gate manage; OP existente e não cancelada)
create or replace function public.op_registrar_aprovacao(p_op_id uuid, p_depto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public._user_has_perm('producao.ordens.manage') then
    raise exception 'Sem permissão para registrar aprovação (producao.ordens.manage).' using errcode = '42501';
  end if;
  select status into v_status from public.op_ordens where id = p_op_id for update;
  if not found then
    raise exception 'Ordem de Produção % não encontrada.', p_op_id using errcode = 'P0002';
  end if;
  if v_status = 'CANCELADA' then
    raise exception 'OP cancelada não aceita registro de aprovação.' using errcode = '22023';
  end if;
  update public.op_ordens
    set aprovado_por = auth.uid(),
        aprovado_em = now(),
        aprovado_depto = nullif(p_depto, '')
    where id = p_op_id;
end $$;

-- 5.5 op_registrar_comunicacao: carimba comunicado_* (gate manage; OP existente e não cancelada)
create or replace function public.op_registrar_comunicacao(p_op_id uuid, p_comunicado_a text, p_depto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public._user_has_perm('producao.ordens.manage') then
    raise exception 'Sem permissão para registrar comunicação (producao.ordens.manage).' using errcode = '42501';
  end if;
  select status into v_status from public.op_ordens where id = p_op_id for update;
  if not found then
    raise exception 'Ordem de Produção % não encontrada.', p_op_id using errcode = 'P0002';
  end if;
  if v_status = 'CANCELADA' then
    raise exception 'OP cancelada não aceita registro de comunicação.' using errcode = '22023';
  end if;
  update public.op_ordens
    set comunicado_a = nullif(p_comunicado_a, ''),
        comunicado_depto = nullif(p_depto, ''),
        comunicado_em = now()
    where id = p_op_id;
end $$;

-- Grants das RPCs: só authenticated executa (o gate interno faz o resto)
revoke all on function public.op_criar_ordem(jsonb, jsonb)              from public;
revoke all on function public.op_atualizar_rascunho(uuid, jsonb, jsonb) from public;
revoke all on function public.op_transicao_status(uuid, text, text)     from public;
revoke all on function public.op_registrar_aprovacao(uuid, text)        from public;
revoke all on function public.op_registrar_comunicacao(uuid, text, text) from public;
grant execute on function public.op_criar_ordem(jsonb, jsonb)              to authenticated;
grant execute on function public.op_atualizar_rascunho(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.op_transicao_status(uuid, text, text)     to authenticated;
grant execute on function public.op_registrar_aprovacao(uuid, text)        to authenticated;
grant execute on function public.op_registrar_comunicacao(uuid, text, text) to authenticated;

-- =====================================================================
-- 6) LOCKDOWN de op_proximo_numero: ninguém a chama direto; só por dentro de
--    op_criar_ordem (que roda como owner e mantém o EXECUTE do owner).
-- =====================================================================
revoke execute on function public.op_proximo_numero() from public;
revoke execute on function public.op_proximo_numero() from anon;
revoke execute on function public.op_proximo_numero() from authenticated;

-- =====================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =====================================================================
-- a) colunas de fechamento presentes (2 linhas):
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='op_ordens'
--      and column_name in ('fechada_por','fechada_em');
-- b) permissões (3 linhas) e papéis (2 linhas):
--   select codigo, nome, modulo from public.hub_permissions where modulo='producao' order by codigo;
--   select codigo, nome, is_system from public.hub_roles where modulo='producao' order by codigo;
-- c) wiring (operador_producao=2, gestor_producao=3):
--   select r.codigo, count(*) n from public.hub_role_permissions rp
--     join public.hub_roles r on r.id=rp.role_id
--     join public.hub_permissions p on p.id=rp.permission_id
--    where r.codigo in ('operador_producao','gestor_producao') group by r.codigo order by r.codigo;
-- d) policies op_* = 4 (op_numeracao SEM policy = deny-all), todas cmd=SELECT:
--   select count(*) as n_policies_op from pg_policies where schemaname='public' and tablename like 'op\_%';  -- 4
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public' and tablename like 'op\_%' order by tablename;
-- e) RPCs presentes + SECURITY DEFINER + search_path:
--   select proname, prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and proname in
--      ('op_criar_ordem','op_atualizar_rascunho','op_transicao_status',
--       'op_registrar_aprovacao','op_registrar_comunicacao');
-- f) lockdown + grants (has_function_privilege — proxnum=false, RPCs=true):
--   select
--     has_function_privilege('authenticated','public.op_proximo_numero()','execute')                as proxnum_auth,   -- false
--     has_function_privilege('anon',         'public.op_proximo_numero()','execute')                as proxnum_anon,   -- false
--     has_function_privilege('authenticated','public.op_criar_ordem(jsonb,jsonb)','execute')        as criar_auth,     -- true
--     has_function_privilege('authenticated','public.op_atualizar_rascunho(uuid,jsonb,jsonb)','execute') as atualizar_auth, -- true
--     has_function_privilege('authenticated','public.op_transicao_status(uuid,text,text)','execute')     as transicao_auth, -- true
--     has_function_privilege('authenticated','public.op_registrar_aprovacao(uuid,text)','execute')       as aprov_auth,     -- true
--     has_function_privilege('authenticated','public.op_registrar_comunicacao(uuid,text,text)','execute') as comunic_auth;  -- true
-- g) evidência do gate interno via auth.uid():
--   select pg_get_functiondef('public._user_has_perm(text)'::regprocedure);
-- h) teste funcional (SÓ com sessão autenticada — no SQL Editor sem auth o gate nega, que é o correto):
--   -- begin;
--   --   select public.op_criar_ordem(
--   --     jsonb_build_object('tipo_id',(select id from public.op_tipos where codigo='VALVULA'),
--   --       'tipo_ordem','FABRICACAO','tipo_produto','ACABADO','destino','INTERNACIONAL',
--   --       'produto_familia','Tricvalve','data_inicio', to_char(now(),'YYYY-MM-DD')),
--   --     jsonb_build_array(jsonb_build_object('codigo_produto','001.010.037',
--   --       'codigo_alternativo_produto','82110053','produto_nome','TRICUSPID VALVE',
--   --       'produto_unidade','UNID','quantidade_planejada',10)));
--   -- rollback;

-- =====================================================================
-- ROLLBACK (ordem respeita FKs: funcs/policies -> wiring -> papéis -> permissões -> colunas)
-- =====================================================================
-- drop function if exists public.op_registrar_comunicacao(uuid, text, text);
-- drop function if exists public.op_registrar_aprovacao(uuid, text);
-- drop function if exists public.op_transicao_status(uuid, text, text);
-- drop function if exists public.op_atualizar_rascunho(uuid, jsonb, jsonb);
-- drop function if exists public.op_criar_ordem(jsonb, jsonb);
-- drop policy if exists op_tipos_select            on public.op_tipos;
-- drop policy if exists op_ordens_select           on public.op_ordens;
-- drop policy if exists op_ordem_itens_select      on public.op_ordem_itens;
-- drop policy if exists op_status_historico_select on public.op_status_historico;
-- delete from public.hub_role_permissions
--   where role_id in (select id from public.hub_roles where codigo in ('operador_producao','gestor_producao'));
-- delete from public.hub_roles       where codigo in ('operador_producao','gestor_producao');
-- delete from public.hub_permissions where codigo in ('producao.access','producao.ordens.create','producao.ordens.manage');
-- grant execute on function public.op_proximo_numero() to public;   -- restaura estado pré-lockdown
-- alter table public.op_ordens drop column if exists fechada_em;
-- alter table public.op_ordens drop column if exists fechada_por;
