-- =====================================================================
-- Conferência do VND-8 (só leitura).
-- =====================================================================
-- 1. Situação do cadastro e da fila
select (select count(*) from public.nf_saida_serie_cadastro)                               as cadastradas,
       (select count(*) from public.nf_saida_serie_cadastro where status = 'ok')           as ok,
       (select count(*) from public.nf_saida_serie_cadastro where status = 'ausente')      as ausentes,
       (select count(*) from public.nf_saida_serie_cadastro where status = 'erro')         as em_erro,
       (select count(*) from public.nf_saida_serie_cadastro where status = 'estacionado')  as estacionadas,
       (select count(*) from public.v_nf_saida_serie_fila)                                 as na_fila,
       (select count(distinct controle_num_serie) from public.nf_saida_item_serie)          as controles_nas_notas;

-- 2. Amostra: notas de 2026 com o número impresso (comparar com o Balancete, ferramenta buscar_serie)
select s.modelo, s.numero, s.data_emissao, x.sequencia_item, x.controle_num_serie, c.numero_serie, c.numero_ctrl_lote, c.codigo_produto
  from public.nf_saida_item_serie x
  join public.nf_saida s on s.id = x.nf_saida_id
  left join public.nf_saida_serie_cadastro c on c.controle_num_serie = x.controle_num_serie
 where s.data_emissao >= '2026-10-01'
 order by s.data_emissao desc, s.numero desc
 limit 20;

-- 3. Permissões: anon e authenticated não executam as RPCs
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('nf_saida_serie_gravar', 'nf_saida_serie_registrar_falha');
