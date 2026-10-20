-- NFSE-1.10 — rollback (objetos novos). ⚠️ O MCP trava em SQL com DROP/DELETE: colar no SQL Editor.
-- Os arquivos já enviados aos buckets saem pela Storage API ou pelo painel (nunca DELETE em storage.objects).
-- Antes, reverter no código o commit da tela de detalhe.
drop policy if exists nfse_anexos_storage_insert on storage.objects;
drop policy if exists nfse_anexos_storage_select on storage.objects;
drop function if exists public.nfse_anexo_remover(uuid);
drop function if exists public.nfse_anexo_registrar(text, text, uuid, text);
drop function if exists public.nfse_storage_pode_gravar(text);
-- nfse_pode_acessar() é usada pela NFSE-1.11 (nfse_recebida_detalhe): reverter a 1.11 antes.
drop function if exists public.nfse_pode_acessar();
drop table if exists public.nfse_anexo;
-- buckets: só depois de esvaziados pelo painel
-- delete from storage.buckets where id in ('nfse-nf-pdf', 'nfse-boleto-pdf');
