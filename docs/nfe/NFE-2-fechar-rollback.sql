-- NFE-2 — rollback: devolve as policies abertas e os privilégios de authenticated. Só com ordem do Pedro.
-- NÃO devolve nada a anon/PUBLIC (proibição permanente do CLAUDE.md: nenhum GRANT a anon). Antes da NFE-2 o anon
-- tinha privilégio de tabela mas nenhuma policy (RLS bloqueava), então o efeito prático é o mesmo.

drop policy compras_nfe_ler on public.compras_nfe;
create policy "Allow all for authenticated on compras_nfe" on public.compras_nfe
  for all to authenticated using (true) with check (true);
grant insert, update, delete, truncate, references, trigger on public.compras_nfe to authenticated;

drop policy compras_nfe_pedidos_ler on public.compras_nfe_pedidos;
create policy "Allow all for authenticated on compras_nfe_pedidos" on public.compras_nfe_pedidos
  for all to authenticated using (true) with check (true);
grant insert, update, delete, truncate, references, trigger on public.compras_nfe_pedidos to authenticated;

create policy fila_chaves_authenticated_all on public.compras_nfe_fila_chaves
  for all to authenticated using (true) with check (true);
grant all on public.compras_nfe_fila_chaves to authenticated;

grant execute on function public.cadastrar_nfe(jsonb, jsonb, text) to authenticated;
grant execute on function public.cadastrar_nfe_da_fila(jsonb, text, text) to authenticated;
grant execute on function public.enfileirar_chaves_nfe(text[], text) to authenticated;
