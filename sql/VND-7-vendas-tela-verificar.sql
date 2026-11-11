-- Conferência do VND-7 (rodar depois de aplicar sql/VND-7-vendas-tela.sql).
-- 1) Objetos e privilégios: anon não executa nada; authenticated só as 3 RPCs (o filtro interno, nenhuma).
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('_vendas_notas_filtradas', 'vendas_notas_listar', 'vendas_nota_detalhe', 'vendas_itens_listar')
 order by 1;
-- Esperado: _vendas_notas_filtradas → definer f, anon f, authenticated f; as outras três → definer t, anon f, authenticated t.

-- 2) Papel e permissão ligados; ninguém com o papel ainda.
select r.codigo as papel, p.codigo as permissao,
       (select count(*) from public.hub_user_roles ur where ur.role_id = r.id and ur.revogado_em is null) as usuarios
  from public.hub_roles r
  join public.hub_role_permissions rp on rp.role_id = r.id
  join public.hub_permissions p on p.id = rp.permission_id
 where r.codigo = 'visualizador_vendas';

-- 3) Totais do mês batem com a tabela (sem passar pela RPC, que exige login).
select to_char(date_trunc('month', data_emissao), 'YYYY-MM') as mes,
       count(*) as notas, count(*) filter (where cancelada) as canceladas,
       round(sum(valor_total) filter (where not cancelada), 2) as valor_nao_canceladas
  from public.v_nf_saida
 where tipo_nota = 'Saída' and data_emissao >= date_trunc('month', current_date) - interval '2 months'
 group by 1 order by 1;
