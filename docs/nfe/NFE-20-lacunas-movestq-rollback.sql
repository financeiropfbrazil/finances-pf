-- NFE-20 — rollback (em partes; cada uma pode ser feita sozinha)

-- B1) Parar de enfileirar lacunas (o que já está na fila segue sendo lido pelo job 34)
select cron.unschedule('rastreio-lacunas-movestq');
drop function if exists public.rastreio_enfileirar_lacunas(integer);

-- B2) (opcional) Tirar da fila as lacunas ainda não lidas
delete from public.rastreio_nf_fila q
where q.origem in ('lacuna', 'amostra_lacuna')
  and not exists (select 1 from public.rastreio_nf r where r.codigo_empresa_filial = q.codigo_empresa_filial and r.chave_movestq = q.chave_movestq);

-- B3) (opcional) Apagar as leituras que as lacunas gravaram. ATENÇÃO: as NF-e reconhecidas por elas (ex.: 15058 da
-- Alegria, 374 da BLUEIT) voltam a "não encontradas". Os vínculos com pedido gravados por essas leituras
-- (rastreio_nf_pedido) também saem. Conferir antes com o item 3 do verificar.
-- delete from public.rastreio_nf_pedido p using public.rastreio_nf_fila q
--  where q.origem in ('lacuna', 'amostra_lacuna') and p.codigo_empresa_filial = q.codigo_empresa_filial and p.chave_movestq = q.chave_movestq;
-- delete from public.rastreio_nf r using public.rastreio_nf_fila q
--  where q.origem in ('lacuna', 'amostra_lacuna') and r.codigo_empresa_filial = q.codigo_empresa_filial and r.chave_movestq = q.chave_movestq;

-- A) Voltar compras_nfe_no_alvo e rastreio_atualizar_candidatas à versão anterior à NFE-20.
-- SÓ depois do B3 (sem o filtro, laudo/RM/ajuste/saída lidos pelas lacunas poderiam casar NF-e por número).
do $$
declare v_def text; v_old text;
begin
  v_def := pg_get_functiondef('public.compras_nfe_no_alvo(date,date)'::regprocedure);
  v_old := replace(v_def, E'\n      and r.operacao is distinct from \'Saída\'', '');
  v_old := replace(v_old, E'\n      -- NFE-20: só documento fiscal (laudo, RM e ajuste do Alvo têm numeração própria)\n      and upper(coalesce(r.especie, \'\')) in (\'NF-E\', \'NFS-E\', \'CT-E\', \'DIV\', \'FAT\', \'NF3E\', \'NF3-E\', \'NFCOM\')', '');
  if md5(v_old) <> 'ca4072ed6bf5de182da6aaba7f0c5a1e' then raise exception 'compras_nfe_no_alvo: reconstrução não bateu'; end if;
  execute v_old;

  v_def := pg_get_functiondef('public.rastreio_atualizar_candidatas()'::regprocedure);
  v_old := replace(v_def, E'\n    where n.operacao is distinct from \'Saída\'\n      and upper(coalesce(n.especie, \'\')) in (\'NF-E\', \'NFS-E\', \'CT-E\', \'DIV\', \'FAT\', \'NF3E\', \'NF3-E\', \'NFCOM\')', '');
  v_old := replace(v_old, E'\n    -- NFE-20: só documento fiscal (laudo, RM e ajuste do Alvo têm numeração própria)', '');
  if md5(v_old) <> 'e6a552b9d82d9b3c914bb0cd6a219719' then raise exception 'rastreio_atualizar_candidatas: reconstrução não bateu'; end if;
  execute v_old;
end $$;
