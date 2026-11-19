-- =====================================================================
-- Rollback do VND-3 (sql/VND-3-nf-saida.sql). Remove SÓ os objetos nf_saida*.
-- Apaga os dados importados — rodar apenas com ordem expressa do Pedro.
-- =====================================================================
drop view if exists public.v_nf_saida_paises_sem_regiao;
drop view if exists public.v_nf_saida_lacunas;
drop view if exists public.v_nf_saida;

drop function if exists public.nf_saida_registrar_falha(uuid, text);
drop function if exists public.nf_saida_gravar_detalhe(uuid, jsonb);
drop function if exists public.nf_saida_registrar_lista(jsonb);
drop function if exists public.nf_saida__aplicar_cabecalho(uuid, jsonb);

drop table if exists public.nf_saida_classe;
drop table if exists public.nf_saida_parcela;
drop table if exists public.nf_saida_item_serie;
drop table if exists public.nf_saida_item_lote;
drop table if exists public.nf_saida_item;
drop table if exists public.nf_saida_versao;
drop table if exists public.nf_saida;
drop table if exists public.nf_saida_pais_regiao;

drop function if exists public.nf_saida__ts(text);
drop function if exists public.nf_saida__dt(text);
drop function if exists public.nf_saida__bool(text);
