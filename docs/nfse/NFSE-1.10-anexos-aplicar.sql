-- =====================================================================
-- NFSE-1.10 — Anexos da NFS-e: PDF da nota e PDF do boleto (PLANO-NFSE.md) — 20/10/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (20/10/2026): "Anexo 1: UPLOAD ... a NF em PDF. Também precisamos
-- de um Bucket" / "Anexo 2: ... Upload e bucket do pdf do BOLETO ... pré-requisito para lançar no futuro".
-- Padrão do PROJ-L9 (sql/PROJ-L9-anexos.sql): pasta privada, tabela fechada, escrita só por RPC.
--
-- O QUE CRIA (tudo novo; nada existente muda):
--   1. Buckets privados 'nfse-nf-pdf' e 'nfse-boleto-pdf' — só PDF, até 10 MB.
--   2. Tabela public.nfse_anexo (1 linha por arquivo; no máximo 1 ATIVO por nota e tipo).
--   3. Regras: nfse_pode_acessar() e nfse_storage_pode_gravar(name).
--   4. Policies do storage: SELECT e INSERT presas aos 2 buckets. SEM UPDATE e SEM DELETE de propósito:
--      trocar o arquivo = enviar outro (o anterior fica "substituído"); remover = marcar (o arquivo fica, histórico).
--   5. RPCs nfse_anexo_registrar e nfse_anexo_remover (envelope {success, ...}; sem permissão = 42501).
-- Caminho: {chave_acesso de 50 dígitos}/{uuid}.pdf — a RPC monta o caminho e exige o arquivo na pasta.
-- Medido em 20/10: as policies de storage.objects são todas presas ao próprio bucket e as 3 RESTRICTIVE do
-- compras-requisicoes excluem os outros buckets → pasta nova nasce fechada.
-- Rollback: NFSE-1.10-anexos-rollback.sql.
-- =====================================================================

-- ── 0. Pré-voo ───────────────────────────────────────────────────────
-- select count(*) from public.compras_pedidos;                                              -- ≈ 2.312 em 20/10/2026
-- select to_regclass('public.nfse_anexo');                                                   -- NULL
-- select count(*) from storage.buckets where id in ('nfse-nf-pdf', 'nfse-boleto-pdf');      -- 0

-- ── 1. Buckets ───────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nfse-nf-pdf', 'nfse-nf-pdf', false, 10485760, array['application/pdf']),
       ('nfse-boleto-pdf', 'nfse-boleto-pdf', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- ── 2. Tabela ────────────────────────────────────────────────────────
create table public.nfse_anexo (
  id             uuid primary key default gen_random_uuid(),
  chave_acesso   text not null check (chave_acesso ~ '^[0-9]{50}$'),
  tipo           text not null check (tipo in ('nf', 'boleto')),
  bucket_id      text not null,
  storage_path   text not null unique,
  nome_original  text not null check (length(btrim(nome_original)) between 1 and 255),
  tamanho_bytes  bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 10485760),
  enviado_por    uuid not null,
  enviado_em     timestamptz not null default now(),
  substituido_em timestamptz,          -- outro arquivo do mesmo tipo entrou no lugar
  removido_em    timestamptz,          -- operador tirou o anexo (o arquivo fica na pasta)
  removido_por   uuid,
  constraint nfse_anexo_bucket_do_tipo check ((tipo = 'nf' and bucket_id = 'nfse-nf-pdf')
                                           or (tipo = 'boleto' and bucket_id = 'nfse-boleto-pdf'))
);

comment on table public.nfse_anexo is
  'NFSE-1.10: PDF da nota (tipo nf) e do boleto (tipo boleto) anexados pelo operador a uma NFS-e recebida '
  '(chave de acesso do ADN). Um ativo por nota e tipo; trocar marca o anterior como substituído. Escrita só pelas '
  'RPCs nfse_anexo_registrar / nfse_anexo_remover; leitura pela RPC nfse_recebida_detalhe.';

create unique index nfse_anexo_ativo_uq on public.nfse_anexo (chave_acesso, tipo)
  where substituido_em is null and removido_em is null;
create index nfse_anexo_chave_idx on public.nfse_anexo (chave_acesso);

alter table public.nfse_anexo enable row level security;
revoke all on public.nfse_anexo from public, anon, authenticated;
grant all on public.nfse_anexo to service_role;
grant select on public.nfse_anexo to klaus_readonly;

-- ── 3. Regras ────────────────────────────────────────────────────────
create function public.nfse_pode_acessar()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public._is_admin() or coalesce(public.user_has_permission(auth.uid(), 'compras.nfse.access'), false);
$$;

-- Gravar na pasta: permissão + caminho {chave}/{uuid}.pdf + a chave é de uma NFS-e com a P&F tomadora.
create function public.nfse_storage_pode_gravar(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.nfse_pode_acessar()
     and p_name ~ '^[0-9]{50}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
     and exists (select 1 from public.nfse_adn_doc d
                  where d.chave_acesso = split_part(p_name, '/', 1)
                    and d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador');
$$;

-- ── 4. Policies do storage (presas aos 2 buckets) ────────────────────
create policy nfse_anexos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id in ('nfse-nf-pdf', 'nfse-boleto-pdf') and public.nfse_pode_acessar());

create policy nfse_anexos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('nfse-nf-pdf', 'nfse-boleto-pdf') and public.nfse_storage_pode_gravar(name));

-- ── 5. RPCs de escrita ───────────────────────────────────────────────
create function public.nfse_anexo_registrar(p_chave text, p_tipo text, p_guid uuid, p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_bucket text;
  v_path   text;
  v_size   bigint;
  v_mime   text;
  v_row    public.nfse_anexo;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.nfse_pode_acessar() then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;

  v_bucket := case p_tipo when 'nf' then 'nfse-nf-pdf' when 'boleto' then 'nfse-boleto-pdf' end;
  if v_bucket is null then
    return jsonb_build_object('success', false, 'erro_codigo', 'tipo_invalido', 'mensagem', 'Tipo de anexo inválido.');
  end if;
  if p_chave is null or p_chave !~ '^[0-9]{50}$'
     or not exists (select 1 from public.nfse_adn_doc d
                     where d.chave_acesso = p_chave and d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador') then
    return jsonb_build_object('success', false, 'erro_codigo', 'nota_inexistente', 'mensagem', 'NFS-e não encontrada.');
  end if;
  if p_nome is null or length(btrim(p_nome)) not between 1 and 255 then
    return jsonb_build_object('success', false, 'erro_codigo', 'nome_invalido', 'mensagem', 'Nome do arquivo inválido.');
  end if;

  -- serializa anexos simultâneos da mesma nota e tipo (o índice de "um ativo" não estoura)
  perform pg_advisory_xact_lock(hashtext('nfse_anexo:' || p_chave || ':' || p_tipo));

  v_path := format('%s/%s.pdf', p_chave, p_guid);
  select (o.metadata->>'size')::bigint, o.metadata->>'mimetype'
    into v_size, v_mime
    from storage.objects o
   where o.bucket_id = v_bucket and o.name = v_path;
  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'arquivo_ausente',
                              'mensagem', 'O arquivo não chegou ao armazenamento. Tente anexar de novo.');
  end if;
  if coalesce(v_mime, 'application/pdf') <> 'application/pdf' then
    return jsonb_build_object('success', false, 'erro_codigo', 'tipo_arquivo', 'mensagem', 'O anexo deve ser PDF.');
  end if;

  update public.nfse_anexo
     set substituido_em = now()
   where chave_acesso = p_chave and tipo = p_tipo and substituido_em is null and removido_em is null;

  insert into public.nfse_anexo (chave_acesso, tipo, bucket_id, storage_path, nome_original, tamanho_bytes, enviado_por)
  values (p_chave, p_tipo, v_bucket, v_path, btrim(p_nome), coalesce(v_size, 1), auth.uid())
  returning * into v_row;

  return jsonb_build_object('success', true, 'anexo', to_jsonb(v_row));
end;
$$;

-- Remover = marcar. O arquivo continua na pasta (sem DELETE no storage: histórico e auditoria).
create function public.nfse_anexo_remover(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.nfse_pode_acessar() then
    raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
  end if;
  update public.nfse_anexo
     set removido_em = now(), removido_por = auth.uid()
   where id = p_id and removido_em is null and substituido_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('success', false, 'erro_codigo', 'anexo_inexistente', 'mensagem', 'Anexo não encontrado ou já trocado.');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

-- ── 6. Privilégios: toda função nova nasce com EXECUTE nominal para anon (CLAUDE.md) ──
revoke execute on function public.nfse_pode_acessar() from public, anon;
revoke execute on function public.nfse_storage_pode_gravar(text) from public, anon;
revoke execute on function public.nfse_anexo_registrar(text, text, uuid, text) from public, anon;
revoke execute on function public.nfse_anexo_remover(uuid) from public, anon;
grant execute on function public.nfse_pode_acessar() to authenticated;
grant execute on function public.nfse_storage_pode_gravar(text) to authenticated;
grant execute on function public.nfse_anexo_registrar(text, text, uuid, text) to authenticated;
grant execute on function public.nfse_anexo_remover(uuid) to authenticated;

-- ── 7. Conferência dentro da transação ───────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.nfse_anexo', 'select')
     or has_table_privilege('authenticated', 'public.nfse_anexo', 'select')
     or has_function_privilege('anon', 'public.nfse_anexo_registrar(text, text, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.nfse_anexo_remover(uuid)', 'execute') then
    raise exception 'ACESSOS: anon/authenticated ficaram com acesso indevido. Transação desfeita.';
  end if;
  if (select count(*) from storage.buckets where id in ('nfse-nf-pdf', 'nfse-boleto-pdf') and not public) <> 2 then
    raise exception 'BUCKETS: os 2 buckets privados não ficaram como esperado. Transação desfeita.';
  end if;
end $$;
