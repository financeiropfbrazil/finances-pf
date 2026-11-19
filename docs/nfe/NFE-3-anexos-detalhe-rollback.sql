-- NFE-3 — rollback: tira o detalhe e os anexos da NF-e. Só com ordem do Pedro.
-- ⚠️ Os ARQUIVOS já enviados aos buckets nfe-nf-pdf / nfe-boleto-pdf NÃO são apagados por SQL (CLAUDE.md: nunca
-- DELETE em storage.objects). Se houver arquivos, os buckets ficam; esvaziar pelo painel/Storage API antes, se o Pedro quiser.
drop function public.nfe_recebida_detalhe(uuid);
drop policy nfe_anexos_storage_insert on storage.objects;
drop policy nfe_anexos_storage_select on storage.objects;
drop function public.nfe_anexo_remover(uuid);
drop function public.nfe_anexo_registrar(text, text, uuid, text);
drop function public.nfe_storage_pode_gravar(text);
drop table public.nfe_anexo;
-- só se os buckets estiverem vazios:
-- delete from storage.buckets where id in ('nfe-nf-pdf', 'nfe-boleto-pdf');
