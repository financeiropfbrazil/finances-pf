-- =====================================================================
-- PROJ-L13b — ROLLBACK (sem DROP/DELETE — pode ir pelo MCP ou SQL Editor)
-- 1) desfaz a troca de trecho nas 9 funções e CONFERE o md5 do corpo contra
--    o valor de antes do L13b (se não bater, para tudo);
-- 2) volta as 2 policies ao texto original;
-- 3) revoga o Gestor do Diego e devolve o Visualizador (L13a).
-- A permissão e o papel ficam cadastrados, sem efeito (nenhuma regra os lê).
-- =====================================================================
set local lock_timeout = '10s';

do $$
declare
  t      record;
  v_def  text;
  v_qtd  int;
  v_md5  text;
begin
  for t in
    select * from (values
      ('public.enviar_budget_para_aprovacao(uuid)',
       'if not v_is_admin and v_projeto.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then',
       'if not v_is_admin and v_projeto.responsavel_id is distinct from v_uid then',
       'c154a10f4985bce1708646aef37d005b'),
      ('public.projeto_marcar_email_aprovacao(uuid)',
       'if not v_is_admin and v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then',
       'if not v_is_admin and v_proj.responsavel_id is distinct from v_uid then',
       'fe8f86c093b0e18b90b947757178e154'),
      ('public.projeto_pedido_arquivos_marcar_enviados(uuid,text)',
       'and (v_req.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all'')))) then',
       'and v_req.responsavel_id = auth.uid())) then',
       'a988e4e01fc76486be0e0a8208df75ba'),
      ('public.projeto_pedido_excluir(uuid)',
       'if v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then',
       'if v_proj.responsavel_id is distinct from v_uid then',
       '7391124f6f0356e80e1ffa4e417869a8'),
      ('public.projeto_pedido_marcar_enviado(uuid,text,boolean,text)',
       'if v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then',
       'if v_proj.responsavel_id is distinct from v_uid then',
       '331a3b6b94032569ac1241a98376f4a6'),
      ('public.projeto_pedido_registrar_aprovacao(uuid,boolean,jsonb)',
       'and (v_req.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all'')))) then',
       'and v_req.responsavel_id = auth.uid())) then',
       '68b9d5a907eaa7b9ec998ae65f2e8fc3'),
      ('public.projeto_pedido_salvar(uuid,uuid,jsonb)',
       'if v_proj.responsavel_id is distinct from v_uid and not public._user_has_perm(''projetos.manage_all'') then',
       'if v_proj.responsavel_id is distinct from v_uid then',
       'ac3f6efcd4589382c9d965bd5c6b6b54'),
      ('public.projeto_pode_gerir_anexos(uuid)',
       'and (pr.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all''))))',
       'and pr.responsavel_id = auth.uid()))',
       'b443339a784160ee8bba723d5efd6524'),
      ('public.projeto_storage_pode_apagar(text)',
       'and (pr.responsavel_id = auth.uid() or public._user_has_perm(''projetos.manage_all''))',
       'and pr.responsavel_id = auth.uid()',
       '94e02b7468968b699ea042c95555bd5e')
    ) as x(fn, antes, depois, md5_original)
  loop
    v_def := pg_get_functiondef(t.fn::regprocedure);
    v_qtd := (length(v_def) - length(replace(v_def, t.antes, ''))) / length(t.antes);
    if v_qtd <> 1 then
      raise exception 'Rollback L13b: trecho esperado 1 vez em %, achado %', t.fn, v_qtd;
    end if;
    execute replace(v_def, t.antes, t.depois);
    select md5(replace(prosrc, E'\r\n', E'\n')) into v_md5 from pg_proc where oid = t.fn::regprocedure;
    if v_md5 <> t.md5_original then
      raise exception 'Rollback L13b: % não voltou ao original (md5 %, esperado %)', t.fn, v_md5, t.md5_original;
    end if;
  end loop;
end $$;

alter policy projetos_update on public.projetos
  using (_is_admin() or (_user_has_perm('projetos.edit_own') and responsavel_id = auth.uid() and fase_atual = 'budget'))
  with check (_is_admin() or (_user_has_perm('projetos.edit_own') and responsavel_id = auth.uid()));

alter policy projetos_delete on public.projetos
  using (_is_admin() or (_user_has_perm('projetos.delete_own') and responsavel_id = auth.uid() and fase_atual = 'budget'));

update public.hub_user_roles
   set revogado_em = now(), revogado_por = '0b52e262-2fd2-4e84-b414-456b8eb6df65',
       motivo = coalesce(motivo, '') || ' | revogado no rollback do L13b'
 where user_id = 'f60a4fbe-07d5-457b-8538-7c3f34db3bed'
   and role_id = (select id from public.hub_roles where codigo = 'gestor_projetos')
   and revogado_em is null;

insert into public.hub_user_roles (user_id, role_id, atribuido_por, motivo)
select 'f60a4fbe-07d5-457b-8538-7c3f34db3bed', r.id, '0b52e262-2fd2-4e84-b414-456b8eb6df65',
       'Devolvido no rollback do L13b: ver todos os projetos'
  from public.hub_roles r
 where r.codigo = 'visualizador_projetos'
   and not exists (select 1 from public.hub_user_roles ur
                    where ur.user_id = 'f60a4fbe-07d5-457b-8538-7c3f34db3bed'
                      and ur.role_id = r.id and ur.revogado_em is null);

notify pgrst, 'reload schema';
