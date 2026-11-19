-- =====================================================================
-- VND-7 — tela Vendas › Notas de Saída: permissão, papel e consultas (só leitura)
-- PLANO-VENDAS.md §17. Aprovado pelo Pedro em 11/11/2026.
-- Rollback: sql/VND-7-vendas-tela-rollback.sql · Conferência: sql/VND-7-vendas-tela-verificar.sql
--
-- O que cria:
--   1. permissão `vendas.notas.access` e papel `visualizador_vendas` (módulo vendas), ligados;
--      nenhum usuário recebe o papel aqui (atribuição é decisão do Pedro, pela tela de usuários);
--   2. `_vendas_notas_filtradas` — filtro comum (interno, sem EXECUTE para anon/authenticated);
--   3. RPCs de leitura, SECURITY DEFINER com gate explícito (admin ou vendas.notas.access):
--      vendas_notas_listar  — notas do período, com resumo e paginação;
--      vendas_nota_detalhe  — uma nota: itens, lotes, séries, parcelas e classes;
--      vendas_itens_listar  — itens das notas do período (para o Excel).
-- O que NÃO faz: nenhuma escrita em nf_saida*, nenhuma policy nova, nada para anon.
-- As tabelas nf_saida* continuam com leitura direta só para admin (RLS do VND-3).
-- =====================================================================

-- 1) Permissão e papel -------------------------------------------------
insert into public.hub_permissions (codigo, nome, descricao, modulo)
select 'vendas.notas.access',
       'Ver notas de saída',
       'Vendas › Notas de Saída: lista, detalhe e Excel das notas fiscais emitidas pela P&F (espelho do Alvo, só leitura).',
       'vendas'
 where not exists (select 1 from public.hub_permissions where codigo = 'vendas.notas.access');

insert into public.hub_roles (codigo, nome, descricao, modulo, is_system)
select 'visualizador_vendas',
       'Visualizador de Vendas',
       'Vê as notas fiscais de saída (Vendas › Notas de Saída), sem alterar nada.',
       'vendas',
       false
 where not exists (select 1 from public.hub_roles where codigo = 'visualizador_vendas');

insert into public.hub_role_permissions (role_id, permission_id)
select r.id, p.id
  from public.hub_roles r
  join public.hub_permissions p on p.codigo = 'vendas.notas.access'
 where r.codigo = 'visualizador_vendas'
   and not exists (select 1 from public.hub_role_permissions x where x.role_id = r.id and x.permission_id = p.id);

-- 2) Filtro comum (interno) --------------------------------------------
-- Só notas emitidas como saída (tipo_nota = 'Saída'); a numeração também tem NF de entrada própria.
-- p_tipos usa tipo_operacao da v_nf_saida; nota sem classe no Alvo = '(sem classe)'.
create or replace function public._vendas_notas_filtradas(
  p_de date, p_ate date, p_busca text, p_modelos text[], p_tipos text[], p_regioes text[], p_incluir_canceladas boolean)
returns setof public.v_nf_saida
language sql
stable
set search_path to 'public'
as $function$
  select v.*
    from public.v_nf_saida v
   where v.tipo_nota = 'Saída'
     and v.data_emissao between p_de and p_ate
     and (p_modelos is null or v.modelo = any(p_modelos))
     and (p_tipos is null or coalesce(v.tipo_operacao, '(sem classe)') = any(p_tipos))
     and (p_regioes is null or coalesce(v.regiao, '(sem região)') = any(p_regioes))
     and (coalesce(p_incluir_canceladas, true) or not v.cancelada)
     and (nullif(btrim(p_busca), '') is null
          or v.razao_social ilike '%' || btrim(p_busca) || '%'
          or v.nome_fantasia ilike '%' || btrim(p_busca) || '%'
          or (nullif(regexp_replace(p_busca, '\D', '', 'g'), '') is not null
              and (v.numero::text = ltrim(regexp_replace(p_busca, '\D', '', 'g'), '0')
                   or v.cpf_cnpj like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'
                   or coalesce(v.numero_pedvenda, '') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')));
$function$;

revoke execute on function public._vendas_notas_filtradas(date, date, text, text[], text[], text[], boolean) from public, anon, authenticated;

-- 3a) Lista do período, com resumo ----------------------------------------
create or replace function public.vendas_notas_listar(
  p_de date,
  p_ate date,
  p_busca text default null,
  p_modelos text[] default null,
  p_tipos text[] default null,
  p_regioes text[] default null,
  p_incluir_canceladas boolean default true,
  p_limit integer default 500,
  p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_res    jsonb;
begin
  if not (public._is_admin() or public.user_has_permission(auth.uid(), 'vendas.notas.access')) then
    raise exception 'Sem permissão para Notas de Saída' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido' using errcode = '22023';
  end if;

  with filtrada as (
    select * from public._vendas_notas_filtradas(p_de, p_ate, p_busca, p_modelos, p_tipos, p_regioes, p_incluir_canceladas)
  ), pagina as (
    select f.* from filtrada f
     order by f.data_emissao desc, f.modelo, f.numero desc
     limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtrada),
    'ultima_leitura_alvo', (select max(n.ultima_leitura_lista_em) from public.nf_saida n),
    'ultima_rodada', (select jsonb_build_object('fim', r.finished_at, 'erros', r.total_erros, 'origem', r.triggered_by)
                        from public.sync_runs r
                       where r.job_type = 'nf_saida' and r.finished_at is not null
                       order by r.finished_at desc limit 1),
    'pendentes_detalhe', (select count(*) from public.nf_saida n where n.detalhe_status <> 'carregado'),
    'agendamento_ligado', coalesce((select s.enabled from public.sync_settings s where s.job_name = 'sync-nf-saida'), false),
    'resumo', jsonb_build_object(
      'notas', (select count(*) from filtrada),
      'canceladas', (select count(*) from filtrada where cancelada),
      'valor_total', (select coalesce(round(sum(valor_total), 2), 0) from filtrada where not cancelada),
      'por_regiao', (select coalesce(jsonb_agg(x order by x.valor desc), '[]'::jsonb)
                       from (select coalesce(regiao, '(sem região)') as regiao, count(*) as notas, round(sum(valor_total), 2) as valor
                               from filtrada where not cancelada group by 1) x),
      'por_tipo', (select coalesce(jsonb_agg(x order by x.valor desc), '[]'::jsonb)
                     from (select coalesce(tipo_operacao, '(sem classe)') as tipo, count(*) as notas, round(sum(valor_total), 2) as valor
                             from filtrada where not cancelada group by 1) x)
    ),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'modelo', p.modelo, 'serie', p.serie, 'numero', p.numero,
                  'data_emissao', p.data_emissao, 'data_competencia', p.data_competencia,
                  'codigo_entidade', p.codigo_entidade, 'razao_social', p.razao_social, 'nome_fantasia', p.nome_fantasia,
                  'cpf_cnpj', p.cpf_cnpj, 'sigla_pais', p.sigla_pais, 'nome_pais', p.nome_pais, 'uf', p.uf,
                  'nome_cidade', p.nome_cidade, 'regiao', p.regiao, 'intercompany_austria', p.intercompany_austria,
                  'natureza_principal', p.natureza_principal, 'abrangencia', p.abrangencia,
                  'classe_principal', p.classe_principal, 'tipo_operacao', p.tipo_operacao,
                  'numero_pedvenda', p.numero_pedvenda, 'vendedor_principal', p.vendedor_principal,
                  'cancelada', p.cancelada, 'data_cancelamento', p.data_cancelamento,
                  'numero_nfse_prefeitura', p.numero_nfse_prefeitura,
                  'moeda_codigo', p.moeda_codigo, 'cambio', p.cambio, 'valor_original', p.valor_original,
                  'valor_total', p.valor_total, 'valor_produto', p.valor_produto, 'valor_servico', p.valor_servico,
                  'valor_frete', p.valor_frete, 'valor_desconto', p.valor_desconto,
                  'valor_icms', p.valor_icms, 'valor_ipi', p.valor_ipi, 'valor_iss', p.valor_iss,
                  'situacao_hub', p.situacao_hub, 'detalhe_status', p.detalhe_status, 'ausente_desde', p.ausente_desde)
                order by p.data_emissao desc, p.modelo, p.numero desc), '[]'::jsonb)
                 from pagina p)
  ) into v_res;
  return v_res;
end;
$function$;

revoke execute on function public.vendas_notas_listar(date, date, text, text[], text[], text[], boolean, integer, integer) from public, anon;
grant execute on function public.vendas_notas_listar(date, date, text, text[], text[], text[], boolean, integer, integer) to authenticated;

-- 3b) Detalhe de uma nota ----------------------------------------------
create or replace function public.vendas_nota_detalhe(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if not (public._is_admin() or public.user_has_permission(auth.uid(), 'vendas.notas.access')) then
    raise exception 'Sem permissão para Notas de Saída' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'nota', to_jsonb(v),
    'itens', (select coalesce(jsonb_agg(to_jsonb(i) - 'nf_saida_id' order by i.sequencia), '[]'::jsonb)
                from public.nf_saida_item i where i.nf_saida_id = v.id),
    'lotes', (select coalesce(jsonb_agg(to_jsonb(l) - 'nf_saida_id' order by l.sequencia_item, l.ordem), '[]'::jsonb)
                from public.nf_saida_item_lote l where l.nf_saida_id = v.id),
    'series', (select coalesce(jsonb_agg(to_jsonb(s) - 'nf_saida_id' order by s.sequencia_item, s.controle_num_serie), '[]'::jsonb)
                 from public.nf_saida_item_serie s where s.nf_saida_id = v.id),
    'parcelas', (select coalesce(jsonb_agg(to_jsonb(p) - 'nf_saida_id' order by p.sequencia_cond, p.sequencia_parcela), '[]'::jsonb)
                   from public.nf_saida_parcela p where p.nf_saida_id = v.id),
    'classes', (select coalesce(jsonb_agg(to_jsonb(c) - 'nf_saida_id' order by c.codigo_classe), '[]'::jsonb)
                  from public.nf_saida_classe c where c.nf_saida_id = v.id)
  ) into v_res
    from public.v_nf_saida v
   where v.id = p_id and v.tipo_nota = 'Saída';

  return v_res;  -- null: nota não existe ou não é de saída
end;
$function$;

revoke execute on function public.vendas_nota_detalhe(uuid) from public, anon;
grant execute on function public.vendas_nota_detalhe(uuid) to authenticated;

-- 3c) Itens do período (Excel) -------------------------------------------
create or replace function public.vendas_itens_listar(
  p_de date,
  p_ate date,
  p_busca text default null,
  p_modelos text[] default null,
  p_tipos text[] default null,
  p_regioes text[] default null,
  p_incluir_canceladas boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if not (public._is_admin() or public.user_has_permission(auth.uid(), 'vendas.notas.access')) then
    raise exception 'Sem permissão para Notas de Saída' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_ate - p_de > 400 then
    raise exception 'Período longo demais para o Excel de itens (máximo de 400 dias)' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'modelo', f.modelo, 'serie', f.serie, 'numero', f.numero, 'data_emissao', f.data_emissao,
           'cliente', f.razao_social, 'pais', f.nome_pais, 'regiao', f.regiao, 'tipo_operacao', f.tipo_operacao,
           'cancelada', f.cancelada, 'sequencia', i.sequencia, 'codigo_produto', i.codigo_produto,
           'codigo_alternativo', i.codigo_alternativo, 'nome_produto', i.nome_produto,
           'natureza_operacao', i.natureza_operacao, 'cfop', i.cfop, 'ncm', i.ncm, 'unidade', i.unidade,
           'quantidade', i.quantidade, 'valor_unitario', i.valor_unitario, 'valor_total', i.valor_total,
           'valor_frete', i.valor_frete, 'valor_desconto', i.valor_desconto, 'valor_icms', i.valor_icms,
           'valor_ipi', i.valor_ipi, 'valor_pis', i.valor_pis, 'valor_cofins', i.valor_cofins, 'valor_iss', i.valor_iss,
           'numero_pedvenda', i.numero_pedvenda)
         order by f.data_emissao, f.modelo, f.numero, i.sequencia), '[]'::jsonb)
    into v_res
    from public._vendas_notas_filtradas(p_de, p_ate, p_busca, p_modelos, p_tipos, p_regioes, p_incluir_canceladas) f
    join public.nf_saida_item i on i.nf_saida_id = f.id;

  return v_res;
end;
$function$;

revoke execute on function public.vendas_itens_listar(date, date, text, text[], text[], text[], boolean) from public, anon;
grant execute on function public.vendas_itens_listar(date, date, text, text[], text[], text[], boolean) to authenticated;
