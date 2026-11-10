-- NFE-S2 — rollback. Só com ordem do Pedro.
-- 1) kill-switch volta como estava (ligado, sem pausa; updated_at de antes: 2026-06-06 00:52:31.537792+00)
update public.sync_settings
   set enabled = true, paused_at = null, paused_by = null, paused_reason = null,
       updated_at = '2026-06-06 00:52:31.537792+00'
 where job_name = 'sync-nfe';

-- 2) call_sync_nfe_cron(text): o ACL de antes tinha EXECUTE para public e anon. NÃO é devolvido de propósito —
--    "qualquer GRANT a anon" é proibição permanente (CLAUDE.md). Nada precisa disso: quem chama a função é
--    sync_cron_trigger_now (SECURITY DEFINER). Se for preciso, só: grant execute ... to authenticated.

-- 3) email_notas_fiscais: volta a policy antiga
drop policy if exists email_notas_fiscais_admin_ler on public.email_notas_fiscais;
create policy "Allow all for authenticated users" on public.email_notas_fiscais
  for all to authenticated using (true) with check (true);

-- 4) Edge import-email-nfe-to-compras: publicar docs/nfe/NFE-S2-import-email-nfe-to-compras-v23.ts (verify_jwt = true).
-- 5) Tela: git revert do commit da NFE-S2 (menu e rotas de "Email NF-e" e "Cron NF-e").
