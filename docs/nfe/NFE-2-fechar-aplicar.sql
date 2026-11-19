-- =====================================================================
-- NFE-2 — fechar as tabelas de NF-e (PLANO-NFE.md) — 30/10/2026. Ordem do Pedro: "Feche a tabela antiga."
-- Projeto: hbtggrbauguukewiknew.
-- Antes: compras_nfe, compras_nfe_pedidos e compras_nfe_fila_chaves com policy ALL using (true) para authenticated
-- (qualquer usuário logado lia e gravava pela API) e privilégios de tabela para anon; cadastrar_nfe,
-- cadastrar_nfe_da_fila e enfileirar_chaves_nfe (SECURITY DEFINER, sem gate) executáveis por anon e PUBLIC.
-- Depois:
--   compras_nfe / compras_nfe_pedidos: só SELECT, e só para quem tem nfe_pode_acessar(); escrita só pelas RPCs da NFE-1.
--   compras_nfe_fila_chaves: só serviço (erp-proxy e Edge receber-chaves-nfe usam a chave de serviço).
--   As 3 RPCs de cadastro: só service_role (são chamadas pelo erp-proxy e pela Edge receber-chaves-nfe, com chave de serviço).
-- NÃO MUDA a entrada da Riosoft: a Edge receber-nfe grava com a chave de serviço (service_role ignora RLS e mantém
-- os privilégios). Nem rastro-nfe-feed (serviço), nem as funções definer (rastreio_atualizar_candidatas,
-- compras_nfe_no_alvo, RPCs da NFE-1), que rodam como postgres.
-- Rollback: NFE-2-fechar-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regprocedure('public.compras_nfe_importar_xml(jsonb,text)') is null
     or to_regprocedure('public.nfe_pode_acessar()') is null then
    raise exception 'NFE-0/NFE-1 não aplicadas — fechar agora quebraria a tela';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public'
        and (tablename, policyname) in (('compras_nfe', 'Allow all for authenticated on compras_nfe'),
                                        ('compras_nfe_pedidos', 'Allow all for authenticated on compras_nfe_pedidos'),
                                        ('compras_nfe_fila_chaves', 'fila_chaves_authenticated_all'))) <> 3
     or (select count(*) from pg_policies where schemaname = 'public'
           and tablename in ('compras_nfe', 'compras_nfe_pedidos', 'compras_nfe_fila_chaves')) <> 3 then
    raise exception 'As policies das tabelas de NF-e mudaram desde a medição de 30/10 — conferir antes de aplicar';
  end if;
end $$;

-- ── compras_nfe ──────────────────────────────────────────────────────
drop policy "Allow all for authenticated on compras_nfe" on public.compras_nfe;
create policy compras_nfe_ler on public.compras_nfe
  for select to authenticated using ((select public.nfe_pode_acessar()));
revoke all on public.compras_nfe from anon;
revoke insert, update, delete, truncate, references, trigger on public.compras_nfe from authenticated;

-- ── compras_nfe_pedidos ──────────────────────────────────────────────
drop policy "Allow all for authenticated on compras_nfe_pedidos" on public.compras_nfe_pedidos;
create policy compras_nfe_pedidos_ler on public.compras_nfe_pedidos
  for select to authenticated using ((select public.nfe_pode_acessar()));
revoke all on public.compras_nfe_pedidos from anon;
revoke insert, update, delete, truncate, references, trigger on public.compras_nfe_pedidos from authenticated;

-- ── compras_nfe_fila_chaves (caminho por certificado, parado; só serviço) ──
drop policy fila_chaves_authenticated_all on public.compras_nfe_fila_chaves;
revoke all on public.compras_nfe_fila_chaves from anon, authenticated;

-- ── RPCs de cadastro: só serviço ─────────────────────────────────────
revoke execute on function public.cadastrar_nfe(jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.cadastrar_nfe_da_fila(jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.enfileirar_chaves_nfe(text[], text) from public, anon, authenticated;

-- ── Conferência dentro da transação ──────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.compras_nfe', 'select')
     or has_table_privilege('authenticated', 'public.compras_nfe', 'insert')
     or has_table_privilege('authenticated', 'public.compras_nfe', 'update')
     or has_table_privilege('authenticated', 'public.compras_nfe', 'delete')
     or has_table_privilege('authenticated', 'public.compras_nfe_pedidos', 'insert')
     or has_table_privilege('authenticated', 'public.compras_nfe_pedidos', 'delete')
     or has_table_privilege('authenticated', 'public.compras_nfe_fila_chaves', 'select')
     or has_function_privilege('anon', 'public.cadastrar_nfe_da_fila(jsonb, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.enfileirar_chaves_nfe(text[], text)', 'execute')
     or has_function_privilege('anon', 'public.cadastrar_nfe(jsonb, jsonb, text)', 'execute') then
    raise exception 'ACESSOS: sobrou acesso indevido. Transação desfeita.';
  end if;
  if not has_table_privilege('service_role', 'public.compras_nfe', 'insert')
     or not has_table_privilege('authenticated', 'public.compras_nfe', 'select')
     or not has_function_privilege('service_role', 'public.cadastrar_nfe_da_fila(jsonb, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.enfileirar_chaves_nfe(text[], text)', 'execute') then
    raise exception 'SERVIÇO/LEITURA: service_role ou a leitura com gate perderam acesso. Transação desfeita.';
  end if;
end $$;
