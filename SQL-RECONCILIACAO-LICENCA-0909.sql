-- ═══════════════════════════════════════════════════════════════════════════
-- RECONCILIAÇÃO — falha por licença esgotada do Alvo · 09/09/2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: 7 requisições ficaram em `aprovada`, sem `numero_alvo` e com
-- `envio_token` preso, entre 12:02 e 13:39 UTC (09:02–10:39 BRT). O ERP recusou
-- com "todas as licenças estão em uso"; o gateway classificou como
-- falha_definitiva = false, e por isso NÃO limpou o token — o que bloqueia o
-- reenvio em `req_iniciar_envio_sem_janela` ("ENVIO_EM_ANDAMENTO_OU_INCERTO").
--
-- PROVA DE QUE NADA FOI CRIADO (export do Alvo, 807 registros, 09/09/2026):
--   · maior número de requisição = 0001484, de 08/09
--   · ZERO requisições com data 09/09
--   · as descrições das 7 não existem no export (as de calibração/usinagem/laser
--     encontradas são antigas e de outros requisitantes)
-- Com isso o desfecho deixa de ser desconhecido e o reenvio passa a ser seguro.
--
-- VIA USADA: `concluir_envio_requisicao(..., p_falha_definitiva := true)` — a
-- mesma RPC que o gateway chama. Ela grava o evento `envio_pos_aprovacao_falha`
-- na auditoria e só então limpa o `envio_token`. Nenhum UPDATE direto em
-- `envio_token`: a trilha continua sendo escrita pelo caminho desenhado.
--
-- EXECUTAR: SQL Editor do Supabase, projeto hbtggrbauguukewiknew, um bloco por
-- vez, conferindo a saída antes de seguir. NÃO rodar o arquivo inteiro de uma vez.
--
-- TOKENS ATUAIS (guardar — são o caminho de rollback):
--   0d87cb3e… e761ac83-0f5a-4f41-a32a-1d3bf58654de
--   d5152e6f… a359558a-bb57-4486-a00a-0fc23f2ba330
--   463f5f4e… 2f86d53b-9ca1-4a36-b1a5-f9a7af27883e
--   d4a58205… 26faca13-2f65-45c4-a8f1-2193811fb875
--   3b38984d… 26cf6522-4963-4e5e-a604-03519159978a
--   88c8351c… 42bc2053-2b00-42e0-91fe-a480550a183c
--   663731a8… e6df25b2-4e60-4afa-b131-5a14ace0b259
--
-- ⚠ ORDEM OBRIGATÓRIA: Bloco 0 → Bloco A (duplicata) → Bloco B (UM teste real de
--   reenvio) → só depois os blocos C. O erro 405 do Alvo ainda está ativo e o
--   envio pode voltar a falhar: liberar os 7 de uma vez e mandar todo mundo
--   reenviar prenderia os 7 tokens de novo.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCO 0 — PRÉ-VOO (obrigatório; não altera nada)
-- ───────────────────────────────────────────────────────────────────────────
-- Confirma o projeto por fingerprint e garante que a sessão NÃO é
-- authenticated/anon — os únicos papéis que `fn_req_protege_aprovacao` barra.
do $prevoo$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'PARE: sessão roda como % — o trigger de proteção vai barrar. Use o SQL Editor.', current_user;
  end if;
end
$prevoo$;

select current_user                                            as usuario_sql,
       (select count(*) from public.compras_pedidos)            as pedidos,       -- ~2.049 neste projeto
       (select count(*) from public.compras_lideres_cc)         as lideres_cc,    -- 15
       (select modo from public.compras_requisicoes_janela)     as janela_modo,   -- precisa ser 'aberta'
       (select count(*) from public.compras_requisicoes
         where status = 'aprovada' and numero_alvo is null and envio_token is not null) as presas; -- 7

-- Retrato das 7 antes de qualquer mudança. GUARDE ESTA SAÍDA.
select id, status, numero_alvo, envio_token,
       to_char(tentativa_envio_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as tentativa_brt,
       left(descricao, 45) as descricao
from public.compras_requisicoes
where status = 'aprovada' and numero_alvo is null and envio_token is not null
order by created_at;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCO A — DUPLICATA: cancelar d5152e6f (mantendo 0d87cb3e)
-- ───────────────────────────────────────────────────────────────────────────
-- Idênticas em requisitante, CC, filial, funcionário, finalidade, descrição,
-- data de necessidade, item (002.005 / 1 UNID) e anexo (mesmo sha256
-- 5dc5b887d6132855…, "PC - 1344_26 - PF.pdf", 241.089 bytes). Só o GUID de
-- upload difere — ele é regenerado a cada tentativa, por design.
-- ⚠ Diferença única: o campo `texto`. A mantida (0d87cb3e, 09:02) diz "Orçamento
--   da calibração em anexo"; a cancelada (d5152e6f, 09:06) diz só "Orçamento em
--   anexo" — a decisão manteve a MAIS ANTIGA do par por causa dessa frase.

-- A1 — conferência ANTES
select id, status, numero_alvo, envio_token, left(erro_ultimo_envio, 60) as erro
from public.compras_requisicoes
where id in ('0d87cb3e-d8ee-4446-bd9e-f49aecd39a95', 'd5152e6f-91ff-4129-9d5a-bce73200dea7');

-- A2 — libera o token pela RPC (0 linhas = estado inesperado, nada foi feito)
select public.concluir_envio_requisicao(
         r.id,
         r.envio_token,
         null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Requisicao cancelada por ser duplicata de 0d87cb3e-d8ee-4446-bd9e-f49aecd39a95.',
         true
       ) as resultado                                    -- esperado: ERRO_REGISTRADO
from public.compras_requisicoes r
where r.id = 'd5152e6f-91ff-4129-9d5a-bce73200dea7'::uuid
  and r.status = 'aprovada'
  and r.numero_alvo is null
  and r.envio_token is not null;

-- A3 — cancela (só roda com o token já liberado por A2)
update public.compras_requisicoes
   set status = 'cancelada', updated_at = now()
 where id = 'd5152e6f-91ff-4129-9d5a-bce73200dea7'::uuid
   and status = 'aprovada'
   and numero_alvo is null
   and envio_token is null
returning id, status, numero_alvo, envio_token, updated_at;

-- A4 — trilha do cancelamento
-- `evento` tem CHECK com lista fechada e não existe rótulo para cancelamento
-- manual; `editada` é o mais próximo que não mente. `cancelada_alvo` seria falso
-- (afirmaria que o ERP cancelou). O que aconteceu vai no payload.
insert into public.compras_requisicoes_auditoria
  (requisicao_id, evento, user_id, user_nome, payload_enviado, sucesso, mensagem_erro)
values
  ('d5152e6f-91ff-4129-9d5a-bce73200dea7'::uuid,
   'editada',
   null,
   'Reconciliacao manual - Pedro',
   jsonb_build_object(
     'acao',      'cancelamento_manual',
     'motivo',    'duplicata de 0d87cb3e-d8ee-4446-bd9e-f49aecd39a95',
     'igualdade', 'requisitante, CC, filial, funcionario, finalidade, descricao, data_necessidade, item 002.005 1 UNID e anexo sha256 5dc5b887d6132855',
     'incidente', 'licenca_esgotada_alvo_09_09_2026',
     'prova',     'export de 807 requisicoes do Alvo em 09/09/2026: maior numero 0001484 (08/09), zero documentos com data 09/09',
     'mantida',   '0d87cb3e-d8ee-4446-bd9e-f49aecd39a95'),
   true,
   null)
returning id, requisicao_id, evento, created_at;

-- A5 — conferência DEPOIS
select id, status, numero_alvo, envio_token, left(erro_ultimo_envio, 70) as erro
from public.compras_requisicoes
where id in ('0d87cb3e-d8ee-4446-bd9e-f49aecd39a95', 'd5152e6f-91ff-4129-9d5a-bce73200dea7');
-- esperado: d5152e6f = cancelada, token null · 0d87cb3e = aprovada, token AINDA preso


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCO B — TESTE REAL: libera UMA e reenvia pela tela antes de tocar nas outras
-- ───────────────────────────────────────────────────────────────────────────
-- Escolhida: 663731a8 ("HJWSIHFIUHHJG D", elisangela.silva) — menor valor de
-- negócio entre as 6 e a única autora com login próprio no Alvo
-- (ELISANGELA.SILVA); as outras três saem como PEDRO.SCRIGNOLI de qualquer jeito.

select public.concluir_envio_requisicao(
         r.id, r.envio_token, null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Reenvio liberado.',
         true
       ) as resultado
from public.compras_requisicoes r
where r.id = '663731a8-38ff-45c8-a6d9-5e4db0c8fc7a'::uuid
  and r.status = 'aprovada' and r.numero_alvo is null and r.envio_token is not null;

select id, status, numero_alvo, envio_token, left(erro_ultimo_envio, 70) as erro
from public.compras_requisicoes where id = '663731a8-38ff-45c8-a6d9-5e4db0c8fc7a';

-- ⏸ PARE AQUI. Peça o reenvio pela tela e confira:
--    select id, status, numero_alvo, envio_token from compras_requisicoes
--     where id = '663731a8-38ff-45c8-a6d9-5e4db0c8fc7a';
--    · numero_alvo preenchido + status 'sincronizada' → siga para os blocos C
--    · token preso de novo + erro de licença            → o ERP ainda recusa; pare


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCOS C — as outras 5, SÓ depois do Bloco B ter criado número no ERP
-- ───────────────────────────────────────────────────────────────────────────
-- Todos idênticos, mudando só o id. Rode um, confira, rode o próximo.

-- C1 — 0d87cb3e (nathalia.richele · calibração UV/VIS · a que fica do par)
select public.concluir_envio_requisicao(
         r.id, r.envio_token, null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Reenvio liberado.',
         true) as resultado
from public.compras_requisicoes r
where r.id = '0d87cb3e-d8ee-4446-bd9e-f49aecd39a95'::uuid
  and r.status = 'aprovada' and r.numero_alvo is null and r.envio_token is not null;

select id, status, numero_alvo, envio_token from public.compras_requisicoes
where id = '0d87cb3e-d8ee-4446-bd9e-f49aecd39a95';

-- C2 — 463f5f4e (kemilly.araujo · MATERIAL DE HIGIENE · 2 itens)
select public.concluir_envio_requisicao(
         r.id, r.envio_token, null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Reenvio liberado.',
         true) as resultado
from public.compras_requisicoes r
where r.id = '463f5f4e-e7e8-451f-889c-9cfc457a684f'::uuid
  and r.status = 'aprovada' and r.numero_alvo is null and r.envio_token is not null;

select id, status, numero_alvo, envio_token from public.compras_requisicoes
where id = '463f5f4e-e7e8-451f-889c-9cfc457a684f';

-- C3 — d4a58205 (kemilly.araujo · Impressos)
select public.concluir_envio_requisicao(
         r.id, r.envio_token, null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Reenvio liberado.',
         true) as resultado
from public.compras_requisicoes r
where r.id = 'd4a58205-a57d-41b3-bf4a-be2f20eff7f6'::uuid
  and r.status = 'aprovada' and r.numero_alvo is null and r.envio_token is not null;

select id, status, numero_alvo, envio_token from public.compras_requisicoes
where id = 'd4a58205-a57d-41b3-bf4a-be2f20eff7f6';

-- C4 — 3b38984d (maria.silva · Serviço de usinagem)
select public.concluir_envio_requisicao(
         r.id, r.envio_token, null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Reenvio liberado.',
         true) as resultado
from public.compras_requisicoes r
where r.id = '3b38984d-4714-4505-ae5a-72a80afd8729'::uuid
  and r.status = 'aprovada' and r.numero_alvo is null and r.envio_token is not null;

select id, status, numero_alvo, envio_token from public.compras_requisicoes
where id = '3b38984d-4714-4505-ae5a-72a80afd8729';

-- C5 — 88c8351c (maria.silva · Serviço de corte à laser)
select public.concluir_envio_requisicao(
         r.id, r.envio_token, null,
         'Reconciliado em 09/09/2026: ERP sem licenca recusou o envio e NADA foi criado (export de 807 requisicoes do Alvo: maior numero 0001484, de 08/09). Reenvio liberado.',
         true) as resultado
from public.compras_requisicoes r
where r.id = '88c8351c-76f8-4214-9d98-017ae359d1ae'::uuid
  and r.status = 'aprovada' and r.numero_alvo is null and r.envio_token is not null;

select id, status, numero_alvo, envio_token from public.compras_requisicoes
where id = '88c8351c-76f8-4214-9d98-017ae359d1ae';


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCO D — conferência final das 7
-- ───────────────────────────────────────────────────────────────────────────
select r.id, r.status, r.numero_alvo, r.envio_token is not null as token_preso,
       left(r.descricao, 40) as descricao,
       (select count(*) from public.compras_requisicoes_auditoria a
         where a.requisicao_id = r.id) as eventos_na_trilha
from public.compras_requisicoes r
where r.id in ('0d87cb3e-d8ee-4446-bd9e-f49aecd39a95','d5152e6f-91ff-4129-9d5a-bce73200dea7',
               '463f5f4e-e7e8-451f-889c-9cfc457a684f','d4a58205-a57d-41b3-bf4a-be2f20eff7f6',
               '3b38984d-4714-4505-ae5a-72a80afd8729','88c8351c-76f8-4214-9d98-017ae359d1ae',
               '663731a8-38ff-45c8-a6d9-5e4db0c8fc7a')
order by r.created_at;
-- esperado após tudo: d5152e6f cancelada · as 6 com token_preso = false
-- (e `numero_alvo` preenchido nas que já foram reenviadas com sucesso)


-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ───────────────────────────────────────────────────────────────────────────
-- Liberação do token (qualquer uma das 7): devolve o token original, que está
-- na coluna `envio_token` do retrato do Bloco 0 e também na auditoria
-- (`resposta_alvo->>'token'`). Só faz sentido enquanto numero_alvo for null.
--
--   update public.compras_requisicoes
--      set envio_token = '<token original>'::uuid, updated_at = now()
--    where id = '<id>'::uuid and numero_alvo is null
--   returning id, envio_token;
--
-- Cancelamento da duplicata:
--
--   update public.compras_requisicoes
--      set status = 'aprovada', updated_at = now()
--    where id = 'd5152e6f-91ff-4129-9d5a-bce73200dea7'::uuid and status = 'cancelada'
--   returning id, status;
--
-- A trilha NÃO é revertida — eventos de auditoria não se apagam, por design.
-- Um rollback acrescenta a explicação, não remove o registro.
--
-- ⚠ NÃO usar DELETE em `compras_requisicoes`: itens, rateios, anexos e a própria
--   auditoria saem junto por CASCADE, e a trilha do incidente se perde.
