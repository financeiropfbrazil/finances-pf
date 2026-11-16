-- NFE-19 — rollback. Só com ordem do Pedro. Reverter o commit da tela junto.
-- ⚠️ O índice único "um ativo por (nota, tipo)" só volta se nenhuma nota tiver mais de um arquivo ativo no mesmo tipo.
--    Antes, ver quais têm: select chave_acesso, tipo, count(*) from nfe_anexo where substituido_em is null and removido_em is null group by 1, 2 having count(*) > 1;
--    (idem nfse_anexo) e decidir com o Pedro qual fica — os outros recebem substituido_em = now().
do $$
declare t text; f text; def text; novo text;
begin
  foreach t in array array['nfe', 'nfse'] loop
    -- registrar: tira o bloco do limite/duplicado e devolve o "substituir"
    f := format('public.%s_anexo_registrar(text,text,uuid,text)', t);
    def := pg_get_functiondef(f::regprocedure);
    novo := regexp_replace(def, '-- NFE-19: vários anexos por etapa, até 5;.*?nesta etapa\.''\);\s+end if;',
      format('update public.%s_anexo set substituido_em = now() where chave_acesso = p_chave and tipo = p_tipo and substituido_em is null and removido_em is null;', t));
    execute novo;
    -- relatório: CTE e campos de volta
    f := format('public.%s_relatorio_etapas(date,date)', t);
    def := pg_get_functiondef(f::regprocedure);
    novo := regexp_replace(def, 'anx as \(\s*-- NFE-19:.*?order by a\.chave_acesso, a\.tipo, a\.enviado_em, a\.id\s+\)',
      format(E'anx as (\n    select a.chave_acesso, a.tipo, a.enviado_em, coalesce(pr.full_name, pr.email) as por\n    from public.%s_anexo a\n    left join public.profiles pr on pr.user_id = a.enviado_por\n    where a.substituido_em is null and a.removido_em is null\n      and a.chave_acesso in (select nf.chave_acesso from nf)\n  )', t));
    novo := replace(novo, E'\n           coalesce(anf.qtd, 0) as nf_anexos_qtd, coalesce(abo.qtd, 0) as boleto_anexos_qtd,', '');
    novo := replace(novo, E'\n           ''nf_anexos_qtd'', l.nf_anexos_qtd, ''boleto_anexos_qtd'', l.boleto_anexos_qtd,', '');
    execute novo;
  end loop;
end $$;
drop index if exists public.nfe_anexo_ativo_idx;
drop index if exists public.nfse_anexo_ativo_idx;
create unique index nfe_anexo_ativo_uq on public.nfe_anexo (chave_acesso, tipo) where substituido_em is null and removido_em is null;
create unique index nfse_anexo_ativo_uq on public.nfse_anexo (chave_acesso, tipo) where substituido_em is null and removido_em is null;
-- md5 esperados depois do rollback (relatórios): nfe c2d7d1a7… · nfse e102ac32… (registrar: o "update" volta numa linha só,
-- então o md5 difere do original de 16/11 — o comportamento é o mesmo).
