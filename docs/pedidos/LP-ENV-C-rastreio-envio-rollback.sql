-- Rollback da LP-ENV C (rastreio_compras_listar sem os campos de envio para aprovação).
-- Desfaz a troca de texto da aplicação e confere que a função volta ao md5 medido em 24/11/2026.
-- O Excel do Rastreio continua funcionando: as colunas de envio saem vazias.
do $$
declare
  v_fn   constant regprocedure := 'public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure;
  v_md5_original constant text := '394f02f1cf48ecb0c0ca1efacee7bd84';
  v_old1 constant text := 'end as nf_digitacao';
  v_new1 constant text := 'end as nf_digitacao,' || E'\r\n'
                       || '           env.enviado_aprovacao_em as pedido_envio_aprovacao,' || E'\r\n'
                       || '           env.enviado_aprovacao_origem as pedido_envio_origem';
  v_old2 constant text := 'from pagina0 p0';
  v_new2 constant text := 'from pagina0 p0' || E'\r\n'
                       || '    -- LP-ENV (PLANO-PEDIDOS): envio para aprovação registrado pelo Hub (o Alvo não guarda a data).' || E'\r\n'
                       || '    left join lateral (' || E'\r\n'
                       || '      select cp.enviado_aprovacao_em, cp.enviado_aprovacao_origem' || E'\r\n'
                       || '      from public.compras_pedidos cp' || E'\r\n'
                       || '      where cp.codigo_empresa_filial = ''1.01'' and cp.numero = p0.pedido_numero' || E'\r\n'
                       || '    ) env on true';
  v_def  text := pg_get_functiondef('public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure);
  v_orig text;
begin
  if position(v_new2 in v_def) = 0 or position(v_new1 in v_def) = 0 then
    raise exception 'A função não está na versão LP-ENV C — nada a desfazer';
  end if;
  v_orig := replace(replace(v_def, v_new2, v_old2), v_new1, v_old1);
  if md5(v_orig) <> v_md5_original then
    raise exception 'O texto desfeito não bate com o original (md5 %) — a função mudou depois da LP-ENV C', md5(v_orig);
  end if;
  execute v_orig;
  if md5(pg_get_functiondef(v_fn)) <> v_md5_original then
    raise exception 'Depois do rollback o md5 não bate';
  end if;
end $$;
