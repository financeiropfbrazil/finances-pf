-- =====================================================================
-- LP-ENV C — Envio para aprovação no relatório do Rastreio de Compras (Pedro, 24/11/2026: "Sim, pode começar o 1")
-- Projeto: hbtggrbauguukewiknew.
-- O quê: a RPC rastreio_compras_listar passa a devolver, por linha da página, pedido_envio_aprovacao e
--   pedido_envio_origem (compras_pedidos.enviado_aprovacao_em/_origem, LP-ENV A). O Excel do Rastreio ganha
--   "Envio p/ aprovação", a origem da data e os prazos "Pedido → Envio" e "Envio → Aprovação".
-- Como: troca CIRÚRGICA no texto da função (2 trechos, cada um conferido como único), sem redigitar os 12 KB.
--   Só o CTE "pagina" muda: um left join lateral pela chave única (codigo_empresa_filial, numero) —
--   índice compras_pedidos_empresa_numero_unique, ≤ 1.000 linhas por chamada. Gate, filtros, contagem e
--   ordenação ficam iguais. Campos novos no jsonb são aditivos: a tela do Rastreio ignora o que não usa.
-- ACL: create or replace preserva (authenticated, service_role; anon não tem).
-- Prova de rollback: antes de executar, o script desfaz a troca em memória e confere que volta ao md5 original.
-- Rollback: LP-ENV-C-rastreio-envio-rollback.sql.
-- =====================================================================

do $$
declare
  v_fn   constant regprocedure := 'public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure;
  v_md5_original constant text := '394f02f1cf48ecb0c0ca1efacee7bd84';   -- medido em 24/11/2026
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
  v_def  text;
  v_novo text;
begin
  -- Fingerprint do projeto
  if (select count(*) from public.compras_pedidos) < 2000
     or (select count(*) from information_schema.tables where table_schema = 'public'
          and table_name in ('compras_pedidos', 'compras_requisicoes', 'compras_pedidos_emails_log')) <> 3 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'compras_pedidos' and column_name = 'enviado_aprovacao_em') then
    raise exception 'LP-ENV A não aplicada (falta compras_pedidos.enviado_aprovacao_em)';
  end if;

  v_def := pg_get_functiondef(v_fn);
  if md5(v_def) <> v_md5_original then
    raise exception 'rastreio_compras_listar mudou desde 24/11/2026 (md5 %) — conferir antes', md5(v_def);
  end if;
  if (select count(*) from regexp_matches(v_def, v_old1, 'g')) <> 1
     or (select count(*) from regexp_matches(v_def, v_old2, 'g')) <> 1 then
    raise exception 'Trechos a trocar não são únicos';
  end if;

  v_novo := replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);

  -- Prova de rollback: desfazer em memória tem de voltar ao original byte a byte.
  if md5(replace(replace(v_novo, v_new2, v_old2), v_new1, v_old1)) <> v_md5_original then
    raise exception 'A troca não é reversível — abortado';
  end if;

  execute v_novo;
end $$;

-- Conferência rápida (precisa de auth para a RPC; aqui só o texto):
-- select position('pedido_envio_aprovacao' in pg_get_functiondef('public.rastreio_compras_listar(date,date,text,text,text[],integer,integer)'::regprocedure)) > 0;
