-- NFE-20 — conferência (só leitura)

-- 1. Funções, ACL e job
select p.proname, md5(pg_get_functiondef(p.oid)) as md5, p.proacl::text as acl
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('compras_nfe_no_alvo', 'rastreio_atualizar_candidatas', 'rastreio_enfileirar_lacunas');
-- esperado (19/11/2026): compras_nfe_no_alvo 47b3b9fc… · rastreio_atualizar_candidatas 35c72793… ·
-- rastreio_enfileirar_lacunas só postgres/service_role (anon e authenticated sem EXECUTE)
select has_function_privilege('anon', 'public.rastreio_enfileirar_lacunas(integer)', 'execute') as anon,
       has_function_privilege('authenticated', 'public.rastreio_enfileirar_lacunas(integer)', 'execute') as authenticated;
-- esperado: false · false
select jobid, jobname, schedule, active, command from cron.job where jobname = 'rastreio-lacunas-movestq';
-- esperado: 42 · '17 * * * *' · true

-- 2. Andamento da fila de lacunas
select count(*) as na_fila,
       count(*) filter (where exists (select 1 from public.rastreio_nf r where r.codigo_empresa_filial = '1.01' and r.chave_movestq = q.chave_movestq and r.status = 'ok')) as lidas_ok,
       count(*) filter (where exists (select 1 from public.rastreio_nf r where r.codigo_empresa_filial = '1.01' and r.chave_movestq = q.chave_movestq and r.status = 'nao_encontrada')) as excluidas_no_alvo,
       count(*) filter (where exists (select 1 from public.rastreio_tentativa t where t.etapa = 'B2' and t.chave = q.chave_movestq::text)) as com_falha
from public.rastreio_nf_fila q where q.origem in ('lacuna', 'amostra_lacuna');

-- 3. O que as lacunas trouxeram, por operação e espécie
select coalesce(r.operacao, '?') as operacao, coalesce(r.especie, '?') as especie, count(*)
from public.rastreio_nf r join public.rastreio_nf_fila q on q.chave_movestq = r.chave_movestq and q.origem in ('lacuna', 'amostra_lacuna')
group by 1, 2 order by 3 desc;

-- 4. NF-e da tela reconhecidas por causa das lacunas (pela chave de acesso)
select n.numero, n.emitente_nome, n.natureza_operacao, n.valor_total, r.chave_movestq, r.data_entrada
from public.rastreio_nf r
join public.rastreio_nf_fila q on q.chave_movestq = r.chave_movestq and q.origem in ('lacuna', 'amostra_lacuna')
join public.compras_nfe n on n.chave_acesso = r.chave_acesso_nfe
order by r.data_entrada desc;

-- 5. Nenhum documento interno ou de saída casando NF-e por número + entidade (esperado: 0 linhas)
select r.chave_movestq, r.operacao, r.especie, r.numero, n.numero as nfe, n.emitente_nome
from public.rastreio_nf r
join (select distinct codigo_entidade, regexp_replace(cpf_cnpj_entidade, '\D', '', 'g') as cnpj
      from public.fin_parcelas_pagar where cpf_cnpj_entidade is not null) e on e.codigo_entidade = r.codigo_entidade
join public.compras_nfe n on regexp_replace(n.emitente_cnpj, '\D', '', 'g') = e.cnpj and ltrim(n.numero, '0') = ltrim(r.numero, '0')
where (r.operacao = 'Saída' or upper(coalesce(r.especie, '')) not in ('NF-E','NFS-E','CT-E','DIV','FAT','NF3E','NF3-E','NFCOM'))
  and coalesce(r.chave_acesso_nfe, '') <> coalesce(n.chave_acesso, '');

-- 6. Lacunas que ainda faltam (entre 18128 e a maior chave conhecida)
select count(*) as faltam
from generate_series(18128, (select greatest(max(chave_movestq), (select max(chave_movestq) from public.fin_parcelas_pagar))
                             from public.rastreio_nf where codigo_empresa_filial = '1.01')) g
where not exists (select 1 from public.rastreio_nf r where r.codigo_empresa_filial = '1.01' and r.chave_movestq = g)
  and not exists (select 1 from public.fin_parcelas_pagar f where f.chave_movestq = g)
  and not exists (select 1 from public.rastreio_nf_fila q where q.codigo_empresa_filial = '1.01' and q.chave_movestq = g);
