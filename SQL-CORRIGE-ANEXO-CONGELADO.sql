-- =====================================================================
-- SQL-CORRIGE-ANEXO-CONGELADO.sql
-- Causa-raiz do ANEXO_CONGELADO + reconciliação de 0001481 (6aab4fe2)
-- =====================================================================
-- Gerado em 08/09/2026, 10h5x BRT. MCP read-only: NADA foi executado por mim.
--
-- ⚠️ COLE O BLOCO 0 AGORA — o ciclo das 11:00 está a minutos.
-- O documento 0001481 existe no Alvo e NENHUMA linha do Hub tem esse número
-- (conferido: 0 linhas). No próximo ciclo o Job 4 vai encontrá-lo no
-- /req-comp/list, não achar correspondente no Hub, e INSERIR uma linha nova
-- ocupando 0001481 — reproduzindo exatamente o incidente do Tiago de hoje de
-- manhã, e transformando um caso simples em um conflito de chave única.
--
-- =====================================================================
-- 1. POR QUE O TRIGGER BARRA — não é a RPC, é a ORDEM ENTRE DOIS TRIGGERS
-- =====================================================================
-- `compras_requisicoes_arquivos` tem DOIS triggers BEFORE UPDATE. O Postgres
-- dispara triggers de mesmo evento em ORDEM ALFABÉTICA do nome:
--
--   1º  trg_compras_req_arquivos_updated_at  → set_updated_at_compras_req_arquivos()
--                                              faz NEW.updated_at = NOW()
--   2º  trg_req_congelar                     → fn_req_congelar_conteudo()
--
-- ("c" de compras vem antes de "r" de req — a ordem não é escolhida, é acidente
-- de nomenclatura.)
--
-- Quando `concluir_envio_requisicao` roda
--   update compras_requisicoes_arquivos set numero_alvo_ao_enviar = '0001481' ...
-- o 1º trigger já alterou `updated_at` ANTES de o 2º comparar. E o 2º compara:
--
--   (v_new - 'numero_alvo_ao_enviar') is distinct from (v_old - 'numero_alvo_ao_enviar')
--
-- Removida só a chave `numero_alvo_ao_enviar`, sobra `updated_at` — que agora
-- difere. A comparação dá TRUE e o trigger levanta ANEXO_CONGELADO, mesmo o
-- UPDATE tendo mudado exatamente aquilo que a lista branca autoriza.
--
-- NÃO é bug da RPC: ela atualiza a única coluna permitida.
-- NÃO é bug do congelamento em si: a intenção está certa.
-- É uma OMISSÃO na lista branca — e dá para provar: no MESMO arquivo, no ramo
-- de `compras_requisicoes`, a lista branca inclui 'updated_at' explicitamente.
-- No ramo de arquivos, esqueceram. A correção alinha os dois.
--
-- Como a RPC roda tudo numa transação, a exceção do anexo aborta TAMBÉM o
-- UPDATE do cabeçalho: o número não é gravado, o status não vai a
-- 'sincronizada', o token fica preso. Estado final idêntico ao caso do Tiago,
-- por caminho diferente.
--
-- =====================================================================
-- 2. ALCANCE — sim, está quebrado para todo mundo, desde 07/09 15h42
-- =====================================================================
-- Medido: das requisições com anexo que já sincronizaram, 104 de 104 são
-- ANTERIORES ao SQL integral; a mais recente é de 03/09 14:55. ZERO
-- sincronizaram depois de 07/09 15h42 BRT.
--
-- O trigger `trg_req_congelar` sobre `compras_requisicoes_arquivos` nasceu no
-- SQL-INTEGRAL.sql (linha 357), junto com a RPC. Ou seja: o caminho
-- "aprovada + anexo → envio → gravar desfecho" NUNCA funcionou desde a
-- implantação multi-CC. A requisição 6aab4fe2 é a PRIMEIRA a exercitá-lo — não
-- estourou antes só porque a janela ficou restrita ao aceite e ninguém com
-- anexo enviou. É, literalmente, o "caminho feliz que nunca rodou".
--
-- CONSEQUÊNCIA PRÁTICA, enquanto o BLOCO 1 não for aplicado: toda requisição
-- aprovada COM anexo que alguém enviar hoje vai CRIAR O DOCUMENTO NO ERP e
-- falhar ao registrar no Hub, ficando pendurada. Requisições sem anexo não são
-- afetadas (o UPDATE não atinge nenhuma linha e o trigger nem dispara) — foi
-- por isso que a do Tiago, sem anexo, passou por outro motivo.
-- =====================================================================


-- =====================================================================
-- BLOCO 0 — PAUSAR O CRON (agora)
-- =====================================================================
-- Esperado: retorno vazio; depois active = false.

select cron.alter_job(1, active := false);

select jobid, jobname, schedule, active from cron.job where jobid = 1;


-- =====================================================================
-- BLOCO 1 — CORREÇÃO DA CAUSA-RAIZ (é o que destrava todo mundo)
-- =====================================================================
-- Recriada a partir do pg_get_functiondef DO BANCO, não da especificação.
-- Preservados SECURITY DEFINER e search_path=public. Tag nomeada ($fn$) porque
-- o SQL Editor corrompe corpos delimitados por $$.
--
-- ÚNICA mudança em todo o corpo: na condição do ANEXO_CONGELADO, a comparação
-- passa a descontar 'updated_at' além de 'numero_alvo_ao_enviar' — igual ao que
-- o ramo de `compras_requisicoes` já fazia.
--
-- O que continua barrado (o congelamento NÃO é afrouxado): trocar arquivo,
-- storage_path, conteudo_sha256, nome_original, mime_type, tamanho_bytes ou
-- upload_identify_guid de requisição já submetida, e todo INSERT/DELETE de
-- anexo depois da submissão.
--
-- Esperado: CREATE FUNCTION (a função é substituída no lugar).

create or replace function public.fn_req_congelar_conteudo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_old jsonb; v_new jsonb; v_id uuid; v_ids uuid[]:='{}'; v_req compras_requisicoes;
begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 if tg_table_name='compras_requisicoes' then
   if tg_op='UPDATE' and old.aprovacao_submetida_em is not null and old.numero_alvo is null
     and (to_jsonb(new)-array['status','aprovada_por_user_id','aprovada_em','aprovacao_automatica','rejeitada_por_user_id','rejeitada_em','motivo_rejeicao','motivo_rejeicao_codigo','updated_at','enviado_em','tentativa_envio_em','erro_ultimo_envio','numero_alvo','envio_token'])
       is distinct from (to_jsonb(old)-array['status','aprovada_por_user_id','aprovada_em','aprovacao_automatica','rejeitada_por_user_id','rejeitada_em','motivo_rejeicao','motivo_rejeicao_codigo','updated_at','enviado_em','tentativa_envio_em','erro_ultimo_envio','numero_alvo','envio_token']) then
     raise exception 'REQUISICAO_CONGELADA: clone para alterar o conteudo';
   end if;
 else
   if tg_table_name='compras_requisicoes_rateio_cc' then
     select array_agg(requisicao_id) into v_ids from compras_requisicoes_rateio_classes
       where id in ((v_old->>'rateio_classe_id')::uuid,(v_new->>'rateio_classe_id')::uuid);
   elsif tg_table_name='compras_requisicoes_itens_classe_rec_desp' then
     select array_agg(requisicao_id) into v_ids from compras_requisicoes_itens
       where id in ((v_old->>'item_id')::uuid,(v_new->>'item_id')::uuid);
   else v_ids:=array[(v_old->>'requisicao_id')::uuid,(v_new->>'requisicao_id')::uuid]; end if;
   for v_id in select distinct x from unnest(v_ids) x where x is not null order by x loop
     select * into v_req from compras_requisicoes where id=v_id for update;
     -- ▼▼ ÚNICA LINHA ALTERADA: 'updated_at' entra na lista branca ▼▼
     if tg_table_name='compras_requisicoes_arquivos' and v_req.aprovacao_submetida_em is not null
       and (tg_op<>'UPDATE' or (v_new-array['numero_alvo_ao_enviar','updated_at']) is distinct from (v_old-array['numero_alvo_ao_enviar','updated_at'])) then
       raise exception 'ANEXO_CONGELADO'; end if;
     -- ▲▲ fim da alteração ▲▲
     if v_req.aprovacao_submetida_em is not null and v_req.numero_alvo is null then raise exception 'REQUISICAO_CONGELADA: itens e rateio nao podem mudar'; end if;
     if current_setting('role',true) in ('authenticated','anon') and v_req.numero_alvo is null and (v_req.status<>'rascunho'
       or (v_req.requisitante_user_id is distinct from auth.uid() and not coalesce((select is_admin from profiles where user_id=auth.uid()),false))) then raise exception 'SEM_PERMISSAO'; end if;
   end loop;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end;
$fn$;

-- ACL: `create or replace` sobre função existente preserva o ACL, e o atual já
-- é {postgres=X/postgres,service_role=X/postgres} — anon/authenticated fora.
-- O revoke abaixo é defensivo e idempotente (regra do projeto: função em
-- `public` pode nascer com EXECUTE nominal para anon).
revoke execute on function public.fn_req_congelar_conteudo() from public, anon, authenticated;

-- Conferência: esperado prosecdef = true, search_path=public,
-- acl = {postgres=X/postgres,service_role=X/postgres},
-- tem_correcao = true, triggers_intactos = 6.
select p.prosecdef, p.proconfig, p.proacl::text as acl,
       pg_get_functiondef(p.oid) like '%array[''numero_alvo_ao_enviar'',''updated_at'']%' as tem_correcao,
       (select count(*) from pg_trigger where tgfoid = p.oid and not tgisinternal) as triggers_intactos
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='fn_req_congelar_conteudo';


-- =====================================================================
-- BLOCO 2 — PRÉ-VOO DO CASO (somente leitura)
-- =====================================================================
-- Esperado: status='aprovada' · numero=null · token NÃO nulo · anexos=1
--           numero_alvo_ao_enviar=null · linhas_com_0001481=0 · cron=false
--
-- ⛔ Antes de seguir, confirme no ERP que 0001481 é ESTA requisição:
--    2 monitores + 1 mouse sem fio, CC 00010.00002.00003, digitada hoje ~10:44.
--    (Ontem o ERP reatribuiu um número; a conferência custa 30 segundos.)

select
  (select status      from public.compras_requisicoes where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as status,
  (select numero_alvo from public.compras_requisicoes where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as numero,
  (select envio_token from public.compras_requisicoes where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as token,
  (select count(*)    from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexos,
  (select numero_alvo_ao_enviar from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexo_numero,
  (select left(conteudo_sha256,16) from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexo_sha,
  (select count(*)    from public.compras_requisicoes where btrim(coalesce(numero_alvo,''))='0001481') as linhas_com_0001481,
  (select active      from cron.job where jobid=1) as cron_ativo;


-- =====================================================================
-- BLOCO 3 — CONCLUIR A RECONCILIAÇÃO (preservando o anexo)
-- =====================================================================
-- Só depois do BLOCO 1 aplicado — sem ele, isto falha com ANEXO_CONGELADO
-- outra vez.
--
-- Não há conflito de chave desta vez: nada a liberar, nada a apagar. A RPC faz
-- tudo, e agora o UPDATE do anexo passa pelo trigger corrigido:
--   • grava numero_alvo='0001481', status='sincronizada', enviado_em=now();
--   • propaga numero_alvo_ao_enviar='0001481' para mouse-optico.jpg;
--   • audita como envio_pos_aprovacao_sucesso.
-- O anexo é PRESERVADO: storage_path, conteudo_sha256, guid e bytes não são
-- tocados — só a coluna que registra com que número ele foi enviado.
-- Idempotente por token: se rodar duas vezes, a segunda devolve SINCRONIZADA
-- sem alterar nada. Nenhum Insert é repetido no ERP.
--
-- Esperado: resultado = 'SINCRONIZADA'.

begin;

insert into public.compras_requisicoes_auditoria
  (requisicao_id, evento, user_id, user_nome, sucesso, resposta_alvo, mensagem_erro)
values
  ('6aab4fe2-aecd-4848-8e2d-a7531d8c7f32', 'editada', null,
   'Reconciliação manual — Pedro', true,
   jsonb_build_object(
     'acao', 'reconciliacao de envio incerto',
     'numero_alvo_confirmado', '0001481',
     'confirmado_por', 'Pedro, conferencia direta no ERP',
     'causa', 'Insert concluido no Alvo; concluir_envio_requisicao abortou em ANEXO_CONGELADO ao propagar numero_alvo_ao_enviar para o anexo, porque o trigger de updated_at roda antes do trigger de congelamento e a lista branca do ramo de anexos nao descontava updated_at.',
     'correcao_aplicada', 'fn_req_congelar_conteudo — updated_at incluido na lista branca do ramo de anexos',
     'sem_novo_insert', true),
   'Conclusao idempotente pela RPC concluir_envio_requisicao apos correcao do trigger. Anexo preservado.');

select public.concluir_envio_requisicao(
         '6aab4fe2-aecd-4848-8e2d-a7531d8c7f32'::uuid,
         (select envio_token from public.compras_requisicoes
           where id = '6aab4fe2-aecd-4848-8e2d-a7531d8c7f32'),
         '0001481',
         null,
         false
       ) as resultado;

commit;


-- =====================================================================
-- BLOCO 4 — LIMPEZA DA LINHA RESIDUAL DE ONTEM (6d096fc7)
-- =====================================================================
-- Efeito colateral do incidente da manhã: o ciclo das 10:00:04 rodou ANTES da
-- reconciliação (o cron não chegou a ser pausado) e o Job 4 promoveu a linha de
-- 'cancelada' para 'sincronizada' — exatamente o cenário previsto. Depois a
-- reconciliação tirou o número dela. Hoje ela está 'sincronizada' SEM número:
-- estado inconsistente, que polui listas e relatórios.
--
-- Isto a devolve a 'cancelada', que é o que ela de fato é (o documento foi
-- excluído no Alvo). Não apaga nada; a auditoria segue intacta.
--
-- Esperado: 1 linha, status='cancelada', numero_alvo=null.

update public.compras_requisicoes
   set status = 'cancelada',
       updated_at = now()
 where id = '6d096fc7-b65c-4baf-90c6-07c266ac1e73'
   and numero_alvo is null
   and status = 'sincronizada'
returning id, status, numero_alvo;


-- =====================================================================
-- BLOCO 5 — CONFERÊNCIA FINAL (somente leitura)
-- =====================================================================
-- Esperado:
--   status='sincronizada' · numero='0001481' · anexo_numero='0001481'
--   anexo_sha inalterado (9b6a36585cca1480) · anexos=1 (nada apagado)
--   residual_status='cancelada' · token_sem_numero=0 · numero_duplicado=0

select
  (select status      from public.compras_requisicoes where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as status,
  (select numero_alvo from public.compras_requisicoes where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as numero,
  (select to_char(enviado_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS')
     from public.compras_requisicoes where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32')                  as enviado_brt,
  (select count(*)    from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexos,
  (select numero_alvo_ao_enviar from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexo_numero,
  (select left(conteudo_sha256,16) from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexo_sha,
  (select nome_original from public.compras_requisicoes_arquivos where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32') as anexo_nome,
  (select status      from public.compras_requisicoes where id='6d096fc7-b65c-4baf-90c6-07c266ac1e73') as residual_status,
  (select count(*) from public.compras_requisicoes
    where envio_token is not null and numero_alvo is null)                                             as token_sem_numero,
  (select count(*) from (select nullif(btrim(numero_alvo),'') n from public.compras_requisicoes
                          where nullif(btrim(numero_alvo),'') is not null
                          group by 1 having count(*)>1) d)                                             as numero_duplicado;


-- =====================================================================
-- BLOCO 6 — RELIGAR O CRON
-- =====================================================================
-- Só depois do BLOCO 5 vir como esperado. Com 0001481 já apontando para a
-- requisição certa, o Job 4 vai casar o list com ela e não criar linha nova.

select cron.alter_job(1, active := true);

select jobid, jobname, schedule, active from cron.job where jobid = 1;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BLOCO 1 (trigger): para voltar à versão anterior, repita o mesmo
-- `create or replace` trocando a linha marcada por:
--     and (tg_op<>'UPDATE' or (v_new-'numero_alvo_ao_enviar') is distinct from (v_old-'numero_alvo_ao_enviar'))
-- ⚠️ Mas isso REINTRODUZ o bloqueio de todo envio com anexo. Só faça se a
--    correção provocar efeito inesperado, e com o cron pausado.
--
-- BLOCO 3 é atômico: se falhar, nada é aplicado. Se precisar desfazer depois:
--     update public.compras_requisicoes
--        set numero_alvo=null, status='aprovada', enviado_em=null, updated_at=now()
--      where id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32';
--     update public.compras_requisicoes_arquivos
--        set numero_alvo_ao_enviar=null
--      where requisicao_id='6aab4fe2-aecd-4848-8e2d-a7531d8c7f32';
--   (com o cron pausado, senão o Job 4 captura 0001481)
--
-- BLOCO 4: `update ... set status='sincronizada' where id='6d096fc7...'`.
--
-- Não apague eventos de auditoria em nenhum cenário.
-- =====================================================================
