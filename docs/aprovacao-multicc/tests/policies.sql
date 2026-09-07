alter table public.compras_requisicoes_arquivos enable row level security;
alter table public.compras_requisicoes_auditoria enable row level security;
alter table public.compras_requisicoes_itens enable row level security;
alter table public.compras_requisicoes_itens_classe_rec_desp enable row level security;
alter table public.compras_requisicoes enable row level security;
alter table public.compras_requisicoes_rateio_classes enable row level security;
alter table public.compras_requisicoes_rateio_cc enable row level security;
create policy "arquivos_delete_own" on public.compras_requisicoes_arquivos for DELETE to authenticated using (((uploaded_by_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM compras_requisicoes r
  WHERE ((r.id = compras_requisicoes_arquivos.requisicao_id) AND (r.numero_alvo IS NULL))))));
create policy "arquivos_insert_auth" on public.compras_requisicoes_arquivos for INSERT to authenticated with check ((EXISTS ( SELECT 1
   FROM compras_requisicoes r
  WHERE (r.id = compras_requisicoes_arquivos.requisicao_id))));
create policy "arquivos_select_auth" on public.compras_requisicoes_arquivos for SELECT to authenticated using ((EXISTS ( SELECT 1
   FROM compras_requisicoes r
  WHERE (r.id = compras_requisicoes_arquivos.requisicao_id))));
create policy "arquivos_update_auth" on public.compras_requisicoes_arquivos for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM compras_requisicoes r
  WHERE (r.id = compras_requisicoes_arquivos.requisicao_id)))) with check ((EXISTS ( SELECT 1
   FROM compras_requisicoes r
  WHERE (r.id = compras_requisicoes_arquivos.requisicao_id))));
create policy "audit_req_insert" on public.compras_requisicoes_auditoria for INSERT to authenticated with check (true);
create policy "audit_req_select" on public.compras_requisicoes_auditoria for SELECT to authenticated using (true);
create policy "Allow all for authenticated on compras_requisicoes_itens" on public.compras_requisicoes_itens for ALL to authenticated using (true) with check (true);
create policy "Allow all for authenticated on compras_requisicoes_itens_classe" on public.compras_requisicoes_itens_classe_rec_desp for ALL to authenticated using (true) with check (true);
create policy "Allow all for authenticated on compras_requisicoes" on public.compras_requisicoes for ALL to authenticated using (true) with check (true);
create policy "compras_requisicoes_rateio_classes_select_authenticated" on public.compras_requisicoes_rateio_classes for SELECT to authenticated using (true);
create policy "compras_requisicoes_rateio_cc_select_authenticated" on public.compras_requisicoes_rateio_cc for SELECT to authenticated using (true);
revoke all on function public.req_replace_rateio(uuid,jsonb,text),public._req_evento(uuid,text,jsonb,boolean) from public,anon,authenticated;
