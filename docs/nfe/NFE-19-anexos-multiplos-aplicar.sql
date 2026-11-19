-- =====================================================================
-- NFE-19 — vários anexos por etapa (PDF da nota e boleto), NF-e e NFS-e — 16/11/2026
-- Projeto: hbtggrbauguukewiknew. Pedido do Pedro (16/11): "Seria possível refatorarmos para esse recurso receber mais
-- de um anexo, no mesmo local?" Decisões: 1) as duas etapas; 2) limite de 5 por etapa; 3) Excel com a quantidade e o
-- primeiro envio.
--
-- O que muda:
--   1. nfe_anexo / nfse_anexo: sai o índice ÚNICO "um ativo por (nota, tipo)" e entra um índice comum.
--   2. nfe_anexo_registrar / nfse_anexo_registrar: deixam de marcar o anexo anterior como substituído; recusam com
--      mensagem quando a etapa já tem 5 arquivos ativos ou quando o mesmo arquivo (nome + tamanho) já está anexado.
--      (O arquivo recusado fica no Storage sem registro, como já acontecia nas outras recusas — não há policy de DELETE.)
--   3. nfe_relatorio_etapas / nfse_relatorio_etapas: uma linha por (nota, tipo) com o PRIMEIRO envio, quem enviou e a
--      quantidade — sem isso a nota sairia repetida no Excel; campos novos nf_anexos_qtd e boleto_anexos_qtd.
--   Remover (por id), detalhe (já lista todos) e Storage não mudam.
-- Rollback: NFE-19-anexos-multiplos-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if md5(pg_get_functiondef('public.nfe_anexo_registrar(text,text,uuid,text)'::regprocedure))  <> 'ee1ac3070a42544d1786b443f93305cc'
  or md5(pg_get_functiondef('public.nfse_anexo_registrar(text,text,uuid,text)'::regprocedure)) <> '980a2cb2e9545da3e77bc21f2bd83dc1'
  or md5(pg_get_functiondef('public.nfe_relatorio_etapas(date,date)'::regprocedure))           <> 'c2d7d1a76493240b5763f5d77caeb314'
  or md5(pg_get_functiondef('public.nfse_relatorio_etapas(date,date)'::regprocedure))          <> 'e102ac32052a2188333b891fd15428c3' then
    raise exception 'Alguma das funções mudou desde a leitura de 16/11 — revisar antes de aplicar';
  end if;
  if to_regclass('public.nfe_anexo_ativo_uq') is null or to_regclass('public.nfse_anexo_ativo_uq') is null then
    raise exception 'Índices únicos não encontrados — NFE-19 já aplicada?';
  end if;
end $$;

-- 1. Índices
drop index public.nfe_anexo_ativo_uq;
drop index public.nfse_anexo_ativo_uq;
create index nfe_anexo_ativo_idx on public.nfe_anexo (chave_acesso, tipo) where substituido_em is null and removido_em is null;
create index nfse_anexo_ativo_idx on public.nfse_anexo (chave_acesso, tipo) where substituido_em is null and removido_em is null;

-- 2 e 3. Funções (troca de trechos no próprio banco, cada troca conferida)
do $$
declare
  t      text;
  f      text;
  def    text;
  novo   text;
  n      int;
  padrao text;
begin
  -- 2. registrar
  foreach t in array array['nfe', 'nfse'] loop
    f := format('public.%s_anexo_registrar(text,text,uuid,text)', t);
    def := pg_get_functiondef(f::regprocedure);
    padrao := format('update public\.%s_anexo\s+set substituido_em = now\(\)\s+where chave_acesso = p_chave and tipo = p_tipo and substituido_em is null and removido_em is null;', t);
    n := (select count(*) from regexp_matches(def, padrao, 'g'));
    if n <> 1 then raise exception '%: trecho do "substituir" encontrado % vez(es)', f, n; end if;
    novo := regexp_replace(def, padrao, format($r$-- NFE-19: vários anexos por etapa, até 5; o mesmo arquivo (nome + tamanho) não entra duas vezes
  if (select count(*) from public.%1$s_anexo a
       where a.chave_acesso = p_chave and a.tipo = p_tipo and a.substituido_em is null and a.removido_em is null) >= 5 then
    return jsonb_build_object('success', false, 'erro_codigo', 'limite',
                              'mensagem', 'Esta etapa já tem 5 arquivos. Remova um para anexar outro.');
  end if;
  if exists (select 1 from public.%1$s_anexo a
              where a.chave_acesso = p_chave and a.tipo = p_tipo and a.substituido_em is null and a.removido_em is null
                and a.nome_original = btrim(p_nome) and a.tamanho_bytes = coalesce(v_size, 1)) then
    return jsonb_build_object('success', false, 'erro_codigo', 'duplicado',
                              'mensagem', 'Este arquivo já está anexado nesta etapa.');
  end if;$r$, t));
    execute novo;
    if md5(pg_get_functiondef(f::regprocedure)) <> md5(novo) then raise exception 'Troca não conferiu em %', f; end if;
  end loop;

  -- 3. relatórios do Excel
  foreach t in array array['nfe', 'nfse'] loop
    f := format('public.%s_relatorio_etapas(date,date)', t);
    def := pg_get_functiondef(f::regprocedure);

    padrao := format('anx as \(\s*select a\.chave_acesso, a\.tipo, a\.enviado_em, coalesce\(pr\.full_name, pr\.email\) as por\s+from public\.%s_anexo a\s+left join public\.profiles pr on pr\.user_id = a\.enviado_por\s+where a\.substituido_em is null and a\.removido_em is null\s+and a\.chave_acesso in \(select nf\.chave_acesso from nf\)\s+\)', t);
    n := (select count(*) from regexp_matches(def, padrao, 'g'));
    if n <> 1 then raise exception '%: CTE anx encontrada % vez(es)', f, n; end if;
    novo := regexp_replace(def, padrao, format($r$anx as (
    -- NFE-19: vários anexos por etapa — uma linha por (nota, tipo): primeiro envio, quem enviou e quantidade
    select distinct on (a.chave_acesso, a.tipo)
           a.chave_acesso, a.tipo, a.enviado_em, coalesce(pr.full_name, pr.email) as por,
           count(*) over (partition by a.chave_acesso, a.tipo) as qtd
    from public.%s_anexo a
    left join public.profiles pr on pr.user_id = a.enviado_por
    where a.substituido_em is null and a.removido_em is null
      and a.chave_acesso in (select nf.chave_acesso from nf)
    order by a.chave_acesso, a.tipo, a.enviado_em, a.id
  )$r$, t));

    if (length(novo) - length(replace(novo, 'abo.enviado_em as boleto_anexado_em, abo.por as boleto_anexado_por,', ''))) / length('abo.enviado_em as boleto_anexado_em, abo.por as boleto_anexado_por,') <> 1 then
      raise exception '%: colunas de anexo do select não encontradas uma vez', f;
    end if;
    novo := replace(novo, 'abo.enviado_em as boleto_anexado_em, abo.por as boleto_anexado_por,',
      'abo.enviado_em as boleto_anexado_em, abo.por as boleto_anexado_por,' || E'\n' ||
      '           coalesce(anf.qtd, 0) as nf_anexos_qtd, coalesce(abo.qtd, 0) as boleto_anexos_qtd,');

    if (length(novo) - length(replace(novo, '''boleto_anexado_em'', l.boleto_anexado_em, ''boleto_anexado_por'', l.boleto_anexado_por,', ''))) / length('''boleto_anexado_em'', l.boleto_anexado_em, ''boleto_anexado_por'', l.boleto_anexado_por,') <> 1 then
      raise exception '%: chaves de anexo do JSON não encontradas uma vez', f;
    end if;
    novo := replace(novo, '''boleto_anexado_em'', l.boleto_anexado_em, ''boleto_anexado_por'', l.boleto_anexado_por,',
      '''boleto_anexado_em'', l.boleto_anexado_em, ''boleto_anexado_por'', l.boleto_anexado_por,' || E'\n' ||
      '           ''nf_anexos_qtd'', l.nf_anexos_qtd, ''boleto_anexos_qtd'', l.boleto_anexos_qtd,');

    execute novo;
    if md5(pg_get_functiondef(f::regprocedure)) <> md5(novo) then raise exception 'Troca não conferiu em %', f; end if;
  end loop;
end $$;
