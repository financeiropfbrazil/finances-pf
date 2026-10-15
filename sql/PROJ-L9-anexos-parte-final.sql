-- =====================================================================
-- PROJ-L9 — PARTE FINAL (colar no SQL Editor do Supabase hbtggrbauguukewiknew)
--
-- Por que separado: o MCP do Supabase trava (timeout de 60 s) em qualquer
-- comando que contenha DELETE/DROP — ele pede uma confirmação que o ambiente
-- do Claude Code não exibe. O resto do L9 já foi aplicado pelo MCP em
-- 15/10/2026 (tabela, 8 funções, policy ppa_select, privilégios, pasta).
--
-- O que este bloco cria (nada é apagado — o DELETE aparece só como REGRA):
--   1. RPC projeto_pedido_arquivo_excluir (tira o anexo de um pedido ainda
--      em rascunho; o "delete" é da linha do anexo, dentro da função).
--   2. As 3 regras da pasta 'projetos-pedidos': ler, gravar, apagar arquivo.
--
-- ESTADO: APLICADO pelo Pedro em 15/10/2026 (verificado por leitura depois).
--
-- O SQL Editor vai avisar "destructive operation" por causa da palavra
-- DELETE. Pode confirmar: nenhuma linha existente é afetada.
-- =====================================================================
begin;

create or replace function public.projeto_pedido_arquivo_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.projeto_pedido_arquivos;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  select * into v_row
    from public.projeto_pedido_arquivos
   where id = p_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'erro_codigo', 'nao_encontrado',
                              'mensagem', 'Anexo não encontrado.');
  end if;

  if not public.projeto_pode_gerir_anexos(v_row.requisicao_id) then
    raise exception 'Este anexo não pode mais ser removido (pedido já enviado ao ERP, ou sem permissão).'
      using errcode = '42501';
  end if;

  delete from public.projeto_pedido_arquivos where id = p_id;

  return jsonb_build_object('success', true, 'storage_path', v_row.storage_path);
end;
$$;

revoke execute on function public.projeto_pedido_arquivo_excluir(uuid) from anon, public;
grant execute on function public.projeto_pedido_arquivo_excluir(uuid)  to authenticated;

create policy projetos_pedidos_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'projetos-pedidos' and public.projeto_storage_pode_ler(name));

create policy projetos_pedidos_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'projetos-pedidos' and public.projeto_storage_pode_gravar(name));

create policy projetos_pedidos_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'projetos-pedidos' and public.projeto_storage_pode_apagar(name));

commit;

notify pgrst, 'reload schema';
