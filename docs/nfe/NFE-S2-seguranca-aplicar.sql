-- =====================================================================
-- NFE-S2 — desarmar o caminho por certificado e aposentar "Email NF-e" (PLANO-NFE.md) — 10/11/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (10/11): "todas, em sequência" (propostas da revisão de 10/11).
--
-- Problema 1 (regra 2 do plano: nada por certificado): call_sync_nfe_cron(text) era executável por anon (sem gate,
--   BL-27) e o kill-switch sync_settings.sync-nfe estava ligado — uma chamada anônima disparava sync-nfe-cron →
--   erp-proxy /nfe/sync-batch (SEFAZ com o certificado A1). Fila vazia e nada rodando desde 11/06, mas armado.
-- Problema 2: email_notas_fiscais (tela "Email NF-e", parada desde 14/05; 23 linhas, XML inclusive) tinha policy
--   ALL using (true) para authenticated: qualquer usuário logado lia e alterava.
-- O que muda:
--   1. sync_settings 'sync-nfe' → enabled = false (com motivo). sync_cron_trigger_now('nfe') passa a recusar
--      ("Cron está pausado"); nenhum pg_cron chama o job (conferido).
--   2. call_sync_nfe_cron(text): sem EXECUTE para public, anon e authenticated. Quem chama é sync_cron_trigger_now
--      (SECURITY DEFINER, roda como dono) — continua podendo, mas o kill-switch barra.
--   3. email_notas_fiscais: sai "Allow all for authenticated users"; entra só leitura para admin. A Edge que grava
--      nela (process-email-nfe) usa a chave de serviço e não depende de policy. Nada no banco lê a tabela (conferido).
--   Fora deste arquivo: Edge import-email-nfe-to-compras troca por uma versão que recusa tudo (cópia da v23 em
--   NFE-S2-import-email-nfe-to-compras-v23.ts) e a tela tira "Email NF-e" e "Cron NF-e" do menu e das rotas.
--   Nada é apagado: linhas, anexos e arquivos continuam.
-- Rollback: NFE-S2-seguranca-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.call_sync_nfe_cron(text)'::regprocedure) <> '5de53b91b80af3e26bd6ac3a1c15627c' then
    raise exception 'call_sync_nfe_cron mudou — conferir antes de aplicar';
  end if;
  if not exists (select 1 from public.sync_settings where job_name = 'sync-nfe' and enabled) then
    raise exception 'Kill-switch sync-nfe já está desligado — NFE-S2 já aplicada?';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_notas_fiscais'
                  and policyname = 'Allow all for authenticated users') then
    raise exception 'Policy de email_notas_fiscais não é a esperada — conferir antes de aplicar';
  end if;
end $$;

update public.sync_settings
   set enabled = false,
       paused_at = now(),
       paused_reason = 'NFE-S2 (PLANO-NFE, 10/11/2026): caminho por certificado desarmado — nada de NF-e pela SEFAZ (regra 2). Religar só com ordem do Pedro.',
       updated_at = now()
 where job_name = 'sync-nfe' and enabled;

revoke execute on function public.call_sync_nfe_cron(text) from public, anon, authenticated;

drop policy "Allow all for authenticated users" on public.email_notas_fiscais;
create policy email_notas_fiscais_admin_ler on public.email_notas_fiscais
  for select to authenticated using ((select public._is_admin()));
comment on policy email_notas_fiscais_admin_ler on public.email_notas_fiscais is
  'NFE-S2 (PLANO-NFE, 10/11/2026): "Email NF-e" aposentada — só admin lê; ninguém grava pela API.';
