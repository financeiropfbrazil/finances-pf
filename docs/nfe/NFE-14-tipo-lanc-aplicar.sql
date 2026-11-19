-- =====================================================================
-- NFE-14 — tipo de lançamento (cabeçalho do MovEstq) nas telas de NF-e e NFS-e e no Excel (PLANO-NFE.md) — 11/11/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (11/11): "Inserir ... o dado TIPO DE LANÇAMENTO, em uma entrada no
-- MOVESTQ"; decisão: "Só cabeçalho".
--
-- Fonte: rastreio_nf.codigo_tipo_lanc (CodigoTipoLanc do cabeçalho do MovEstq, gravado pela sync-parcelas-pagar-cron).
-- O item também tem CodigoTipoLanc no Alvo (no espelho de estoque difere do cabeçalho em 6 de 286 entradas — E0000158
-- no cabeçalho, E0000003 nos itens); fica de fora por decisão do Pedro.
-- Descrição: o catálogo do Hub (stock_tipos_lanc) — cobre só parte dos códigos e algumas descrições foram escritas à
-- mão; o Alvo não manda o nome do tipo no MovEstq. A tela mostra o código e usa a descrição só como apoio.
-- O que cria: função nova alvo_tipo_lanc(bigint[]) — só leitura, gate nfe_pode_acessar() ou nfse_pode_acessar(),
-- até 5.000 chaves por chamada; revoke de public e anon. Nada existente muda.
-- Rollback: NFE-14-tipo-lanc-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regprocedure('public.alvo_tipo_lanc(bigint[])') is not null then
    raise exception 'alvo_tipo_lanc já existe — NFE-14 já aplicada?';
  end if;
end $$;

create function public.alvo_tipo_lanc(p_chaves bigint[])
returns table(chave_movestq bigint, codigo_tipo_lanc text, descricao text)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
begin
  if not (public.nfe_pode_acessar() or public.nfse_pode_acessar()) then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;
  if coalesce(array_length(p_chaves, 1), 0) > 5000 then
    raise exception 'No máximo 5.000 lançamentos por consulta' using errcode = '22023';
  end if;
  return query
  select r.chave_movestq, r.codigo_tipo_lanc, t.descricao
  from public.rastreio_nf r
  left join public.stock_tipos_lanc t on t.codigo_tipo_lanc = r.codigo_tipo_lanc
  where r.codigo_empresa_filial = '1.01' and r.chave_movestq = any(p_chaves);
end;
$fn$;

comment on function public.alvo_tipo_lanc(bigint[]) is
  'NFE-14 (PLANO-NFE): tipo de lançamento do cabeçalho do MovEstq (rastreio_nf) + descrição do catálogo do Hub, para as telas de NF-e/NFS-e.';

-- Toda função nova em public nasce com EXECUTE nominal para anon (default privileges do Supabase): tirar com a assinatura.
revoke execute on function public.alvo_tipo_lanc(bigint[]) from public, anon;
