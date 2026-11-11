-- =====================================================================
-- NFE-16 — comentários (etapa 7) no Excel de etapas da NF-e e da NFS-e (PLANO-NFE.md) — 11/11/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (11/11): "inserir, nas colunas finais, os comentários de cada registro
-- das NFe e NFS também" → "na tela já está, certo? Quero adicionar os Comentários no excel"; formato "Todos + resumo".
--
-- O que cria: nota_comentarios_lote(tipo, chaves[]) → jsonb [{chave_acesso, comentarios: [{texto, criado_em, autor}]}]
--   só das notas que têm comentário, cada lista do mais novo ao mais antigo. Só leitura. Mesmo gate da etapa 7
--   (nfe_pode_acessar / nfse_pode_acessar); até 5.000 chaves por chamada; revoke de public e anon.
--   Uma chamada por download (em lotes), em vez de uma nota_comentarios por nota.
-- Rollback: NFE-16-comentarios-excel-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regclass('public.nota_comentario') is null then
    raise exception 'nota_comentario não existe — aplicar a NFE-15 antes';
  end if;
  if to_regprocedure('public.nota_comentarios_lote(text,text[])') is not null then
    raise exception 'nota_comentarios_lote já existe — NFE-16 já aplicada?';
  end if;
end $$;

create function public.nota_comentarios_lote(p_tipo text, p_chaves text[])
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
  if coalesce(cardinality(p_chaves), 0) > 5000 then
    raise exception 'No máximo 5.000 notas por chamada' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('chave_acesso', x.chave_acesso, 'comentarios', x.comentarios))
    from (
      select c.chave_acesso,
             jsonb_agg(jsonb_build_object(
                 'texto', c.texto, 'criado_em', c.criado_em,
                 'autor', coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Usuário do Hub'))
               order by c.criado_em desc, c.id) as comentarios
      from public.nota_comentario c
      left join public.profiles pr on pr.user_id = c.criado_por
      where c.tipo = p_tipo and c.chave_acesso = any (p_chaves)
      group by c.chave_acesso
    ) x
  ), '[]'::jsonb);
end;
$fn$;

comment on function public.nota_comentarios_lote(text, text[]) is
  'NFE-16: comentários de várias notas de uma vez (Excel de etapas), cada lista do mais novo ao mais antigo.';

-- Toda função nova em public nasce com EXECUTE nominal para anon (default privileges do Supabase): tirar com a assinatura.
revoke execute on function public.nota_comentarios_lote(text, text[]) from public, anon;
