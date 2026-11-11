-- =====================================================================
-- NFE-15 — etapa 7 "Comentários" nas notas (NF-e e NFS-e) (PLANO-NFE.md / PLANO-NFSE.md) — 11/11/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (11/11): "uma nova etapa (Etapa 7) chamada Comentários, onde o usuário
-- do Hub poderá adicionar um comentário em texto (com poucos caracteres) … log decrescente … mostrando hora/min/seg e o
-- usuário. Crie na tabela pertinente". Decisões (11/11, "perfeito"): até 280 caracteres; quem vê a tela comenta (NF-e:
-- compras.nfe.access; NFS-e: compras.nfse.access — inclui o Operador de Compras); só acréscimo (ninguém edita nem apaga).
--
-- O que cria:
--   1. Tabela nota_comentario (tipo 'nfe'|'nfse' + chave de acesso, como os anexos), RLS ligada e SEM policy: ninguém
--      lê nem grava direto pela API; tudo pelas duas funções.
--   2. nota_comentarios(tipo, chave) → jsonb [{id, texto, criado_em, autor, meu}] do mais novo ao mais antigo.
--   3. nota_comentario_adicionar(tipo, chave, texto) → {success, id, criado_em | mensagem}. Texto aparado, 1–280
--      caracteres; a nota tem de existir (compras_nfe / nfse_adn_doc); clique duplo (mesmo usuário, mesma nota, mesmo
--      texto em 10 s) não grava de novo.
--   Gate das duas: nfe_pode_acessar() para 'nfe', nfse_pode_acessar() para 'nfse'. revoke de public e anon.
-- Rollback: NFE-15-comentarios-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regclass('public.nota_comentario') is not null then
    raise exception 'nota_comentario já existe — NFE-15 já aplicada?';
  end if;
end $$;

create table public.nota_comentario (
  id          uuid primary key default gen_random_uuid(),
  tipo        text not null check (tipo in ('nfe', 'nfse')),
  chave_acesso text not null check (char_length(chave_acesso) between 10 and 60),
  texto       text not null check (char_length(texto) between 1 and 280),
  criado_por  uuid not null default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index nota_comentario_nota_idx on public.nota_comentario (tipo, chave_acesso, criado_em desc);
comment on table public.nota_comentario is
  'NFE-15 (PLANO-NFE): comentários dos usuários do Hub nas notas (etapa 7). Só acréscimo; acesso só pelas RPCs nota_comentarios / nota_comentario_adicionar.';

alter table public.nota_comentario enable row level security;
revoke all on table public.nota_comentario from public, anon, authenticated;

create function public.nota_comentarios(p_tipo text, p_chave text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
begin
  if p_tipo = 'nfe' then
    if not public.nfe_pode_acessar() then
      raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
    end if;
  elsif p_tipo = 'nfse' then
    if not public.nfse_pode_acessar() then
      raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
    end if;
  else
    raise exception 'Tipo de nota inválido' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'texto', c.texto, 'criado_em', c.criado_em,
             'autor', coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Usuário do Hub'),
             'meu', c.criado_por = auth.uid())
           order by c.criado_em desc, c.id)
    from public.nota_comentario c
    left join public.profiles pr on pr.user_id = c.criado_por
    where c.tipo = p_tipo and c.chave_acesso = p_chave
  ), '[]'::jsonb);
end;
$fn$;

create function public.nota_comentario_adicionar(p_tipo text, p_chave text, p_texto text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public', 'auth'
as $fn$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id    uuid;
  v_em    timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if p_tipo = 'nfe' then
    if not public.nfe_pode_acessar() then
      raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
    end if;
    if not exists (select 1 from public.compras_nfe where chave_acesso = p_chave) then
      return jsonb_build_object('success', false, 'mensagem', 'Nota não encontrada.');
    end if;
  elsif p_tipo = 'nfse' then
    if not public.nfse_pode_acessar() then
      raise exception 'Sem permissão para Notas de Serviço' using errcode = '42501';
    end if;
    if not exists (select 1 from public.nfse_adn_doc where chave_acesso = p_chave) then
      return jsonb_build_object('success', false, 'mensagem', 'Nota não encontrada.');
    end if;
  else
    raise exception 'Tipo de nota inválido' using errcode = '22023';
  end if;

  if v_texto = '' then
    return jsonb_build_object('success', false, 'mensagem', 'Escreva o comentário.');
  end if;
  if char_length(v_texto) > 280 then
    return jsonb_build_object('success', false, 'mensagem', 'O comentário passa de 280 caracteres.');
  end if;

  -- Clique duplo: o mesmo comentário da mesma pessoa na mesma nota há menos de 10 s não grava de novo.
  select c.id, c.criado_em into v_id, v_em
    from public.nota_comentario c
   where c.tipo = p_tipo and c.chave_acesso = p_chave and c.criado_por = auth.uid()
     and c.texto = v_texto and c.criado_em > now() - interval '10 seconds'
   limit 1;
  if v_id is null then
    insert into public.nota_comentario (tipo, chave_acesso, texto, criado_por)
    values (p_tipo, p_chave, v_texto, auth.uid())
    returning id, criado_em into v_id, v_em;
  end if;

  return jsonb_build_object('success', true, 'id', v_id, 'criado_em', v_em);
end;
$fn$;

comment on function public.nota_comentarios(text, text) is 'NFE-15: comentários de uma nota, do mais novo ao mais antigo.';
comment on function public.nota_comentario_adicionar(text, text, text) is 'NFE-15: acrescenta um comentário (até 280 caracteres) a uma nota.';

-- Toda função nova em public nasce com EXECUTE nominal para anon (default privileges do Supabase): tirar com a assinatura.
revoke execute on function public.nota_comentarios(text, text) from public, anon;
revoke execute on function public.nota_comentario_adicionar(text, text, text) from public, anon;
