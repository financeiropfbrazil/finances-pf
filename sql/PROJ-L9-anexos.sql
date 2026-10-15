-- =====================================================================
-- PROJ-L9 — Anexos nos pedidos de compra do modulo de Projetos (fase Actual)
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 3 (L9) — decisoes do Pedro em 15/10/2026:
--   so fase Actual; ate 3 arquivos PDF/JPG/PNG de ate 5 MB (os limites da rota
--   /ped-comp/insert-multipart do erp-proxy, que ja leva os anexos do Suprimentos).
--
-- ESTADO (15/10/2026, OK do Pedro): aplicado pelo MCP em 5 migrations
--   proj_l9_a_tabela_anexos, proj_l9_b_funcoes_regra_anexos,
--   proj_l9_c_privilegios_e_policy_tabela, proj_l9_d_rpcs_registrar_e_marcar,
--   proj_l9_f_pasta_projetos_pedidos. A parte com DELETE (RPC de excluir anexo
--   + 3 policies da pasta) foi colada pelo Pedro no SQL Editor em 15/10
--   (PROJ-L9-anexos-parte-final.sql) — "Success. No rows returned".
--   Motivo: o MCP trava (timeout 60 s) em qualquer SQL com DELETE/DROP — pede
--   uma confirmacao que o Claude Code nao exibe. A tentativa proj_l9_e (excluir)
--   travou e NAO foi aplicada (conferido por leitura).
-- PRE-REQUISITOS: L1..L3 aplicados (projeto_requisicoes, _is_admin, _user_has_perm).
-- Idempotente: if not exists / on conflict / drop policy if exists / create or replace.
--
-- O QUE CRIA:
--   1. Pasta (bucket) privada 'projetos-pedidos' — 5 MB, PDF/JPG/PNG.
--   2. Tabela public.projeto_pedido_arquivos (metadados; 1 linha por arquivo).
--   3. Funcoes de regra (quem ve / quem mexe), usadas pelas policies.
--   4. Policies da pasta (storage.objects) e SELECT da tabela.
--   5. RPCs de escrita: registrar, excluir, marcar enviados.
--
-- DESENHO (mesmo padrao do L3: tabela fechada, escrita so por RPC):
--   - Caminho do arquivo: {projeto_id}/{requisicao_id}/{guid}.{pdf|jpg|png}.
--     A RPC de registro MONTA o caminho a partir do pedido — nao confia no que
--     o navegador mandar — e exige que o arquivo ja exista na pasta.
--   - So mexe em anexo: responsavel do projeto com projetos.pedidos.create (ou
--     admin), pedido da fase Actual, ainda NAO enviado (rascunho/erro e nao
--     bloqueado). Depois do envio ao Alvo o anexo fica imutavel: nao ha policy
--     de UPDATE e o DELETE exige o pedido ainda editavel.
--   - Ver anexo: a mesma regra do pr_select (admin, view_all, ou view_own sendo
--     responsavel/aprovador).
--   - Pasta nova nasce FECHADA: medido em 15/10, todas as policies permissivas
--     de storage.objects sao presas ao proprio bucket_id; as 3 "guard" do
--     compras-requisicoes sao RESTRICTIVE. Nada de fora alcanca este bucket.
--
-- ###################################################################
-- REGRA DO PROJETO: toda funcao nova em public nasce com EXECUTE para anon
-- (ALTER DEFAULT PRIVILEGES do Supabase). Por isso o bloco 6 revoga de anon,
-- com a assinatura completa, DEPOIS do create.
-- ###################################################################
-- =====================================================================


-- =====================================================================
-- 0) PRE-VOO (rodar antes; parar se divergir)
--    Esperado em 15/10/2026: projetos = 10, projeto_requisicoes ~ 73,
--    compras_pedidos ~ 2.290, tabela e bucket ainda inexistentes.
-- =====================================================================
-- select (select count(*) from public.projetos) as projetos,
--        (select count(*) from public.projeto_requisicoes) as pedidos_projeto,
--        (select count(*) from public.compras_pedidos) as compras_pedidos,
--        to_regclass('public.projeto_pedido_arquivos') as tabela,
--        exists(select 1 from storage.buckets where id = 'projetos-pedidos') as bucket;


-- =====================================================================
-- 1) Pasta privada
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projetos-pedidos', 'projetos-pedidos', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;


-- =====================================================================
-- 2) Metadados dos anexos
--    numero_alvo_ao_enviar / enviado_alvo_em: carimbo de QUAL pedido do Alvo
--    levou o arquivo (preenchido depois do envio bem-sucedido).
-- =====================================================================
create table if not exists public.projeto_pedido_arquivos (
  id                    uuid primary key default gen_random_uuid(),
  projeto_id            uuid not null references public.projetos(id) on delete cascade,
  requisicao_id         uuid not null references public.projeto_requisicoes(id) on delete cascade,
  upload_identify_guid  uuid not null unique,
  nome_original         text not null check (length(btrim(nome_original)) between 1 and 255),
  storage_path          text not null unique,
  mime_type             text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  tamanho_bytes         bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 5242880),
  numero_alvo_ao_enviar text,
  enviado_alvo_em       timestamptz,
  uploaded_by           uuid not null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_projeto_pedido_arquivos_requisicao
  on public.projeto_pedido_arquivos (requisicao_id);
create index if not exists idx_projeto_pedido_arquivos_projeto
  on public.projeto_pedido_arquivos (projeto_id);

alter table public.projeto_pedido_arquivos enable row level security;


-- =====================================================================
-- 3) Funcoes de regra
-- =====================================================================

-- Quem VE o projeto (copia fiel do pr_select do L3).
create or replace function public.projeto_pode_ver(p_projeto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public._is_admin()
      or exists (
           select 1
             from public.projetos pr
            where pr.id = p_projeto_id
              and (public._user_has_perm('projetos.view_all')
                   or (public._user_has_perm('projetos.view_own')
                       and (pr.responsavel_id = auth.uid() or pr.aprovador_id = auth.uid())))
         );
$$;

-- Quem MEXE nos anexos de um pedido: responsavel (ou admin), fase Actual,
-- pedido ainda nao enviado ao ERP.
create or replace function public.projeto_pode_gerir_anexos(p_requisicao_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
      from public.projeto_requisicoes r
      join public.projetos pr on pr.id = r.projeto_id
     where r.id = p_requisicao_id
       and r.fase = 'actual'
       and pr.fase_atual = 'actual'
       and r.status in ('rascunho', 'erro')
       and not r.bloqueado
       and (public._is_admin()
            or (public._user_has_perm('projetos.pedidos.create') and pr.responsavel_id = auth.uid()))
  );
$$;

-- Le a pasta do caminho {projeto}/{requisicao}/{arquivo} como uuid; texto que
-- nao e uuid vira null (uma policy nao pode estourar erro de cast).
create or replace function public.projeto_anexo_pasta_uuid(p_name text, p_nivel int)
returns uuid
language sql
stable
set search_path = public, storage
as $$
  select case
           when (storage.foldername(p_name))[p_nivel] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then ((storage.foldername(p_name))[p_nivel])::uuid
         end;
$$;

-- Storage: ler.
create or replace function public.projeto_storage_pode_ler(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(public.projeto_pode_ver(public.projeto_anexo_pasta_uuid(p_name, 1)), false);
$$;

-- Storage: gravar. O pedido da 2a pasta tem de ser do projeto da 1a pasta.
create or replace function public.projeto_storage_pode_gravar(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
      from public.projeto_requisicoes r
     where r.id = public.projeto_anexo_pasta_uuid(p_name, 2)
       and r.projeto_id = public.projeto_anexo_pasta_uuid(p_name, 1)
  )
  and public.projeto_pode_gerir_anexos(public.projeto_anexo_pasta_uuid(p_name, 2));
$$;

-- Storage: apagar. Mesma regra de gravar; e, para limpar o arquivo que sobrou
-- de um pedido JA EXCLUIDO (rascunho/erro), o responsavel do projeto ou admin.
-- Sem metadado apontando para o arquivo, por construcao (a tabela cascateia).
create or replace function public.projeto_storage_pode_apagar(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.projeto_storage_pode_gravar(p_name)
      or (
           not exists (select 1 from public.projeto_requisicoes r
                        where r.id = public.projeto_anexo_pasta_uuid(p_name, 2))
           and not exists (select 1 from public.projeto_pedido_arquivos a
                            where a.storage_path = p_name)
           and (public._is_admin()
                or exists (select 1 from public.projetos pr
                            where pr.id = public.projeto_anexo_pasta_uuid(p_name, 1)
                              and pr.responsavel_id = auth.uid()
                              and public._user_has_perm('projetos.pedidos.create')))
         );
$$;


-- =====================================================================
-- 4) Policies
--    Pasta: SELECT / INSERT / DELETE. Sem UPDATE de proposito (anexo nao e
--    sobrescrito; trocar = remover e anexar outro, enquanto o pedido e rascunho).
--    Tabela: so SELECT. Escrita exclusiva das RPCs (padrao L3).
-- =====================================================================
drop policy if exists projetos_pedidos_storage_select on storage.objects;
create policy projetos_pedidos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'projetos-pedidos' and public.projeto_storage_pode_ler(name));

drop policy if exists projetos_pedidos_storage_insert on storage.objects;
create policy projetos_pedidos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'projetos-pedidos' and public.projeto_storage_pode_gravar(name));

drop policy if exists projetos_pedidos_storage_delete on storage.objects;
create policy projetos_pedidos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'projetos-pedidos' and public.projeto_storage_pode_apagar(name));

drop policy if exists ppa_select on public.projeto_pedido_arquivos;
create policy ppa_select on public.projeto_pedido_arquivos
  for select to authenticated
  using (public.projeto_pode_ver(projeto_id));


-- =====================================================================
-- 5) RPCs de escrita (envelope D-11: {success, ...}; falha de negocio volta
--    success:false, falta de permissao levanta 42501)
-- =====================================================================

-- Registra um arquivo JA enviado para a pasta. O caminho e montado aqui.
create or replace function public.projeto_pedido_arquivo_registrar(
  p_requisicao_id uuid,
  p_guid          uuid,
  p_nome          text,
  p_mime          text,
  p_tamanho       bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  c_max_anexos constant int := 3;
  v_req   record;
  v_qtd   int;
  v_ext   text;
  v_path  text;
  v_size  bigint;
  v_row   public.projeto_pedido_arquivos;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  -- lock no pedido: serializa anexos simultaneos (o limite de 3 nao estoura)
  select r.id, r.projeto_id
    into v_req
    from public.projeto_requisicoes r
   where r.id = p_requisicao_id
   for update;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  if not public.projeto_pode_gerir_anexos(p_requisicao_id) then
    raise exception 'Anexos só podem ser incluídos pelo responsável do projeto, em pedido do Actual ainda não enviado ao ERP.'
      using errcode = '42501';
  end if;

  v_ext := case p_mime
             when 'application/pdf' then 'pdf'
             when 'image/jpeg'      then 'jpg'
             when 'image/png'       then 'png'
           end;
  if v_ext is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'tipo_invalido',
                              'mensagem', 'O anexo deve ser PDF, JPG ou PNG.');
  end if;

  select count(*) into v_qtd
    from public.projeto_pedido_arquivos
   where requisicao_id = p_requisicao_id;
  if v_qtd >= c_max_anexos then
    return jsonb_build_object('success', false, 'erro_codigo', 'limite_anexos',
                              'mensagem', format('O pedido já tem %s anexos (máximo %s).', v_qtd, c_max_anexos));
  end if;

  v_path := format('%s/%s/%s.%s', v_req.projeto_id, p_requisicao_id, p_guid, v_ext);

  -- o arquivo tem de existir na pasta; o tamanho registrado e o que a pasta
  -- gravou (o informado pelo navegador so vale se o metadado ainda nao existir)
  select (o.metadata->>'size')::bigint
    into v_size
    from storage.objects o
   where o.bucket_id = 'projetos-pedidos'
     and o.name = v_path;
  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'arquivo_ausente',
                              'mensagem', 'O arquivo não chegou ao armazenamento. Tente anexar de novo.');
  end if;

  insert into public.projeto_pedido_arquivos
    (projeto_id, requisicao_id, upload_identify_guid, nome_original, storage_path, mime_type, tamanho_bytes, uploaded_by)
  values
    (v_req.projeto_id, p_requisicao_id, p_guid, btrim(p_nome), v_path, p_mime, coalesce(v_size, p_tamanho), auth.uid())
  returning * into v_row;

  return jsonb_build_object('success', true, 'arquivo', to_jsonb(v_row));
end;
$$;

-- Remove o registro do anexo (pedido ainda editavel). Devolve o caminho para o
-- front apagar o arquivo da pasta pela Storage API (nunca DELETE em storage.objects).
create or replace function public.projeto_pedido_arquivo_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.projeto_pedido_arquivos;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  select * into v_row
    from public.projeto_pedido_arquivos
   where id = p_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrado',
                              'mensagem', 'Anexo não encontrado.');
  end if;

  if not public.projeto_pode_gerir_anexos(v_row.requisicao_id) then
    raise exception 'Este anexo não pode mais ser removido (pedido já enviado ao ERP, ou sem permissão).'
      using errcode = '42501';
  end if;

  delete from public.projeto_pedido_arquivos where id = p_id;

  return jsonb_build_object('success', true, 'storage_path', v_row.storage_path);
end;
$$;

-- Carimba os anexos com o numero do pedido criado no Alvo. So depois que o
-- pedido esta registrado como enviado com ESSE numero.
create or replace function public.projeto_pedido_arquivos_marcar_enviados(
  p_requisicao_id uuid,
  p_numero_alvo   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_req record;
  v_n   int;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  select r.status, r.numero_pedido_alvo, pr.responsavel_id
    into v_req
    from public.projeto_requisicoes r
    join public.projetos pr on pr.id = r.projeto_id
   where r.id = p_requisicao_id;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;

  if not (public._is_admin()
          or ((public._user_has_perm('projetos.pedidos.create') or public._user_has_perm('projetos.pedidos.reenviar'))
              and v_req.responsavel_id = auth.uid())) then
    raise exception 'Sem permissão para registrar o envio dos anexos deste pedido.' using errcode = '42501';
  end if;

  if v_req.status <> 'enviado' or v_req.numero_pedido_alvo is distinct from p_numero_alvo then
    return jsonb_build_object('success', false, 'erro_codigo', 'pedido_nao_enviado',
                              'mensagem', 'O pedido não está registrado como enviado ao ERP com este número.');
  end if;

  update public.projeto_pedido_arquivos
     set numero_alvo_ao_enviar = p_numero_alvo,
         enviado_alvo_em       = now()
   where requisicao_id = p_requisicao_id
     and numero_alvo_ao_enviar is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('success', true, 'marcados', v_n);
end;
$$;


-- =====================================================================
-- 6) Privilegios — revogar de anon/PUBLIC (assinatura completa), liberar
--    para authenticated (as policies rodam como o usuario logado).
-- =====================================================================
revoke execute on function public.projeto_pode_ver(uuid)                              from anon, public;
revoke execute on function public.projeto_pode_gerir_anexos(uuid)                     from anon, public;
revoke execute on function public.projeto_anexo_pasta_uuid(text, int)                 from anon, public;
revoke execute on function public.projeto_storage_pode_ler(text)                      from anon, public;
revoke execute on function public.projeto_storage_pode_gravar(text)                   from anon, public;
revoke execute on function public.projeto_storage_pode_apagar(text)                   from anon, public;
revoke execute on function public.projeto_pedido_arquivo_registrar(uuid, uuid, text, text, bigint) from anon, public;
revoke execute on function public.projeto_pedido_arquivo_excluir(uuid)                from anon, public;
revoke execute on function public.projeto_pedido_arquivos_marcar_enviados(uuid, text) from anon, public;

grant execute on function public.projeto_pode_ver(uuid)                              to authenticated;
grant execute on function public.projeto_pode_gerir_anexos(uuid)                     to authenticated;
grant execute on function public.projeto_anexo_pasta_uuid(text, int)                 to authenticated;
grant execute on function public.projeto_storage_pode_ler(text)                      to authenticated;
grant execute on function public.projeto_storage_pode_gravar(text)                   to authenticated;
grant execute on function public.projeto_storage_pode_apagar(text)                   to authenticated;
grant execute on function public.projeto_pedido_arquivo_registrar(uuid, uuid, text, text, bigint) to authenticated;
grant execute on function public.projeto_pedido_arquivo_excluir(uuid)                to authenticated;
grant execute on function public.projeto_pedido_arquivos_marcar_enviados(uuid, text) to authenticated;

-- tabela fechada: escrita só pelas RPCs (que rodam como dono). TRUNCATE não passa
-- pela RLS, por isso tudo sai do default do Supabase e só o SELECT volta.
-- (Aplicado assim na proj_l9_c; medido depois: authenticated = só SELECT, anon = nada.)
revoke all on public.projeto_pedido_arquivos from anon, authenticated;
grant select on public.projeto_pedido_arquivos to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- 7) VERIFICACAO POR LEITURA (rodar separado, depois do bloco acima)
-- =====================================================================
-- select
--   (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
--      and policyname like 'projetos_pedidos_storage_%')                                   as policies_pasta,   -- 3
--   (select count(*) from pg_policies where schemaname = 'public'
--      and tablename = 'projeto_pedido_arquivos')                                          as policies_tabela,  -- 1 (só SELECT)
--   (select relrowsecurity from pg_class where oid = 'public.projeto_pedido_arquivos'::regclass) as rls_on,      -- true
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('projeto_pode_ver','projeto_pode_gerir_anexos','projeto_anexo_pasta_uuid',
--                         'projeto_storage_pode_ler','projeto_storage_pode_gravar','projeto_storage_pode_apagar',
--                         'projeto_pedido_arquivo_registrar','projeto_pedido_arquivo_excluir',
--                         'projeto_pedido_arquivos_marcar_enviados')
--       and has_function_privilege('anon', p.oid, 'EXECUTE'))                              as anon_executa,     -- 0
--   (select public from storage.buckets where id = 'projetos-pedidos')                     as bucket_publico,   -- false
--   (select file_size_limit from storage.buckets where id = 'projetos-pedidos')            as limite_bytes;     -- 5242880


-- =====================================================================
-- ROLLBACK (manual, nesta ordem):
--   1. Esvaziar a pasta 'projetos-pedidos' pelo painel do Storage ou pela
--      Storage API — NUNCA "delete from storage.objects".
--   2. drop policy if exists projetos_pedidos_storage_select on storage.objects;
--      drop policy if exists projetos_pedidos_storage_insert on storage.objects;
--      drop policy if exists projetos_pedidos_storage_delete on storage.objects;
--   3. drop function if exists public.projeto_pedido_arquivos_marcar_enviados(uuid, text);
--      drop function if exists public.projeto_pedido_arquivo_excluir(uuid);
--      drop function if exists public.projeto_pedido_arquivo_registrar(uuid, uuid, text, text, bigint);
--      drop function if exists public.projeto_storage_pode_apagar(text);
--      drop function if exists public.projeto_storage_pode_gravar(text);
--      drop function if exists public.projeto_storage_pode_ler(text);
--      drop function if exists public.projeto_anexo_pasta_uuid(text, int);
--      drop function if exists public.projeto_pode_gerir_anexos(uuid);
--      drop function if exists public.projeto_pode_ver(uuid);
--   4. drop table if exists public.projeto_pedido_arquivos;
--   5. delete from storage.buckets where id = 'projetos-pedidos';   -- só com a pasta vazia
--   6. notify pgrst, 'reload schema';
-- =====================================================================
