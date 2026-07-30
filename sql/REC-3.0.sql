-- =============================================================================
-- REC-3.0 · Releitura condicional (A) + flag de ausência (B)
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Aditivo e idempotente. Verificação e rollback no fim do arquivo.
--
-- Fingerprint da sessão em que este arquivo foi escrito (30/07/2026):
--   select count(*) from compras_pedidos;  →  1752
--   select count(*) from rec_laudos;       →   756  (todos de 2026)
--
-- ⚠ ORDEM DE APLICAÇÃO — IMPORTA, e o passo 5 é o crítico:
--   0º  BLOCO 0  teste de fumaça (não toca em nada; se falhar, PARE)
--   1º  BLOCO 1  as 3 colunas de estado
--   2º  BLOCO 2  BACKFILL  ← antes da coluna gerada, para ela nascer correta
--   3º  BLOCO 3  coluna gerada `precisa_releitura`
--   4º  BLOCO 4  índice
--   5º  DEPOIS DE TUDO: deploy da Edge Function.
--
--   Por que o deploy vem por último: o passo B novo filtra por
--   `precisa_releitura`. Se a função subir antes do BLOCO 3, o PostgREST
--   responde 400 (coluna inexistente) e o passo B falha INTEIRO — nenhum
--   laudo é enriquecido. O inverso é seguro: aplicar todo este SQL com a
--   função ANTIGA no ar não quebra nada (ela simplesmente ignora as colunas
--   novas, e `precisa_releitura` fica correta mas sem consumidor).
-- =============================================================================


-- ─── BLOCO 0 · TESTE DE FUMAÇA (tabela temporária — produção intocada) ───────
-- Prova DUAS coisas antes de mexer em rec_laudos:
--   (1) como `IS DISTINCT FROM` trata NULL  — é o que decide o backfill;
--   (2) que o Postgres aceita essa expressão numa coluna GERADA (exige
--       IMMUTABLE; `texteq` é 'i', conferido em pg_proc).
-- Se este bloco der erro, PARE e me avise — o desenho do BLOCO 3 cai.
create temp table _rec30_smoke (
  a text,
  b text,
  g boolean generated always as (a is distinct from b) stored
);
insert into _rec30_smoke (a, b) values
  ('Emitido',   'Emitido'),   -- esperado g = false  (iguais → não relê)
  ('Concluído', 'Emitido'),   -- esperado g = true   (mudou    → relê)
  ('Emitido',   null),        -- esperado g = true   ← O CASO DO BACKFILL
  (null,        null);        -- esperado g = false  (ambos vazios)
select a, b, g from _rec30_smoke;
drop table _rec30_smoke;

-- A 3ª linha é a resposta à sua pergunta: com a coluna de carimbo NULA e
-- `status` preenchido, o predicado é TRUE. Como as 756 linhas têm `status`
-- preenchido, SEM BACKFILL as 756 entrariam na fila de releitura de uma vez
-- (~8 rodadas × 100 Loads no Alvo, à toa). O BLOCO 2 existe por isso.


-- ─── BLOCO 1 · COLUNAS DE ESTADO ─────────────────────────────────────────────
alter table public.rec_laudos
  add column if not exists load_status_lido    text,
  add column if not exists load_resultado_lido text,
  add column if not exists ausente_desde       timestamptz;

comment on column public.rec_laudos.load_status_lido is
  'REC-3.0(A): Status do laudo NO MOMENTO da última leitura do Laudo/Load (gravado pelo passo B). Comparado com rec_laudos.status — que o passo A atualiza pela listagem — para detectar que a inspeção mudou e o detalhe precisa ser relido. Sem isso, um laudo lido enquanto ainda estava Emitido ficaria com quantidade_aprovada/reprovada, valor_reprovado, texto_resultado, data_recepcao e codigo_funcionario zerados para sempre.';

comment on column public.rec_laudos.load_resultado_lido is
  'REC-3.0(A): ResultadoAnalise no momento da última leitura do Laudo/Load. Segundo gatilho de releitura, ao lado de load_status_lido. Só estes dois: status e resultado sao o que muda o conteudo da inspecao; o resto do laudo e estavel.';

comment on column public.rec_laudos.ausente_desde is
  'REC-3.0(B): quando o laudo deixou de aparecer na listagem do ano no Alvo (indicio de exclusao na origem — a tela do Alvo tem botao Excluir). NULL = presente na ultima listagem confiavel. O sync NUNCA apaga linha: esta flag e so para auditoria, e volta a NULL sozinha se o laudo reaparecer numa listagem posterior.';


-- ─── BLOCO 2 · BACKFILL (não destrutivo) ─────────────────────────────────────
-- POR QUE NÃO É "GRAVAR O ESTADO ATUAL" — e isto é o ponto mais importante
-- deste arquivo.
--
-- Gravar `load_status_lido = status` zeraria a fila, sim, mas apagaria a
-- divergência REAL e o bug ficaria permanente exatamente nos registros que o
-- manifestam. Há um caso vivo, medido em 30/07/2026:
--
--   laudo 0000002149 · status = 'Concluído' · raw_load->>'Status' = 'Emitido'
--                    · resultado_analise = 'Aprovado' · raw = 'Nenhum'
--                    · quantidade = 180 · quantidade_aprovada = 0
--                    · valor_reprovado = 0 · data_recepcao = null
--
--   Este laudo foi APROVADO (180 unidades) e o espelho diz 0. É o defeito da
--   REC-3.0 fotografado. Com backfill a partir de raw_load, ele fica com
--   carimbo 'Emitido' ≠ status 'Concluído' → precisa_releitura = true → o
--   passo B o relê e conserta. Com backfill a partir do status atual, ele
--   sairia da fila e os 180 aprovados ficariam 0 PARA SEMPRE.
--
-- `raw_load` é o registro do que a última leitura enxergou — ele É o estado
-- anterior. Copiá-lo reconstrói a verdade; copiar o presente destrói a prova.
--
-- Medido em 30/07/2026:
--   · 756 de 756 laudos têm raw_load com as chaves 'Status' e 'ResultadoAnalise';
--   · 755 têm raw_load->>'Status' idêntico ao status atual;
--   · 1 divergente — o 0000002149 acima, que DEVE permanecer na fila.
-- Logo o backfill deixa a fila com exatamente 1 laudo, que é o correto.
-- Aplicado dias depois, qualquer laudo que tenha mudado nesse meio-tempo
-- permanece na fila automaticamente. É seguro em qualquer momento.

-- DRY-RUN — rode ANTES do update e confira os números:
--   select count(*)                                                     as alvo_do_update,
--          count(*) filter (where raw_load is null)                      as sem_raw_load,
--          count(*) filter (where raw_load->>'Status' is distinct from status
--                              or raw_load->>'ResultadoAnalise'
--                                 is distinct from resultado_analise)    as ficarao_na_fila
--     from public.rec_laudos
--    where enriquecido_em is not null and raw_load is not null;
--   -- esperado em 30/07/2026: 756 · 0 · 1

update public.rec_laudos
   set load_status_lido    = raw_load->>'Status',
       load_resultado_lido = raw_load->>'ResultadoAnalise'
 where enriquecido_em is not null
   and raw_load is not null
   and load_status_lido is null
   and load_resultado_lido is null;

-- Laudos sem raw_load (hoje: nenhum) ficam com as colunas NULL e entram na
-- fila — comportamento correto: nunca foram lidos direito.


-- ─── BLOCO 3 · COLUNA GERADA (a fila do passo B) ─────────────────────────────
-- ⚠ ESTA É A 4ª COLUNA — você especificou 3. Justificativa, porque a decisão
-- é sua e é reversível:
--
-- Você escreveu que os carimbos tornam a comparação barata, "um predicado SQL,
-- sem ler jsonb". Só que o PostgREST NÃO COMPARA DUAS COLUNAS ENTRE SI: todo
-- filtro é coluna×literal, e `status IS DISTINCT FROM load_status_lido` não é
-- expressável. Sem esta coluna restam dois caminhos, ambos piores:
--   · avaliar o predicado no client — obriga a LER O ESPELHO INTEIRO a cada
--     execução e, pior, fica à mercê do `db-max-rows` do PostgREST (1.000 por
--     padrão), que CORTA A RESPOSTA EM SILÊNCIO. Com 756 linhas hoje e
--     ~1.300/ano, isso estoura em meses e a fila passa a ignorar os laudos
--     mais antigos sem um único erro no log;
--   · uma view ou RPC — mais DDL, e o teto LOAD_BATCH sairia do banco.
--
-- Com a coluna gerada, o predicado E o teto de 100 ficam no Postgres: o passo
-- B lê 100 linhas, não 756. É literalmente o predicado SQL que você descreveu.
-- STORED (não VIRTUAL) para ser indexável. Recalculada pelo próprio banco em
-- todo INSERT/UPDATE — nenhum código pode esquecer de atualizá-la.
--
-- ⚠ Faz REWRITE da tabela (lock ACCESS EXCLUSIVE). Com 756 linhas é
-- instantâneo; ainda assim, aplique fora das janelas do cron
-- (07h30 / 12h30 / 16h30 BRT).
--
-- Se preferir ficar nas 3 colunas, me diga: eu troco o passo B por leitura
-- paginada com o predicado em JavaScript. Funciona, só é mais frágil.
alter table public.rec_laudos
  add column if not exists precisa_releitura boolean
  generated always as (
    status               is distinct from load_status_lido
    or resultado_analise is distinct from load_resultado_lido
  ) stored;

comment on column public.rec_laudos.precisa_releitura is
  'REC-3.0(A): coluna GERADA — true quando status ou resultado_analise divergem do que a ultima leitura do Laudo/Load carimbou, ou seja, a inspecao mudou e as 12 colunas de detalhe estao desatualizadas. Existe porque o PostgREST nao compara duas colunas entre si; com ela o passo B filtra e aplica o teto LOAD_BATCH no proprio banco. Fila do passo B = (enriquecido_em is null) OR precisa_releitura. Nao escrever: o banco calcula.';


-- ─── BLOCO 4 · ÍNDICE ────────────────────────────────────────────────────────
-- Índice PARCIAL, e a razão de ser parcial é o que o torna barato: em regime
-- normal quase nenhuma linha tem precisa_releitura = true (hoje: 1 de 756),
-- então o índice é minúsculo e localiza os laudos que mudaram sem varrer a
-- tabela. As colunas na ordem do ORDER BY do passo B evitam o sort.
--
-- Honestidade sobre o ganho: com 756 linhas o planner provavelmente prefere
-- seq scan e o índice não muda nada HOJE. Ele existe para quando a tabela
-- passar de alguns milhares — e o custo de escrita é desprezível, porque uma
-- linha só entra/sai do índice quando precisa_releitura vira/deixa de ser true.
create index if not exists rec_laudos_releitura_idx
  on public.rec_laudos (enriquecido_em desc, data_emissao desc)
  where precisa_releitura;

-- A outra metade do OR já tem índice: `rec_laudos_pend_enriq_idx`
-- (parcial sobre enriquecido_em is null) — nada a fazer ali.
--
-- Nenhum índice para `ausente_desde`: não há consumidor. Quando a tela passar
-- a listar ausentes, aí vale:
--   create index if not exists rec_laudos_ausente_idx
--     on public.rec_laudos (ausente_desde) where ausente_desde is not null;


-- =============================================================================
-- VERIFICAÇÃO (rodar DEPOIS de aplicar, ANTES do deploy)
-- =============================================================================
-- fingerprint (deve continuar batendo)
--   select count(*) as fingerprint from public.compras_pedidos;   -- ~1752+
--
-- a) as 4 colunas existem e precisa_releitura é gerada
--   select column_name, data_type, is_generated, generation_expression
--     from information_schema.columns
--    where table_schema='public' and table_name='rec_laudos'
--      and column_name in ('load_status_lido','load_resultado_lido',
--                          'ausente_desde','precisa_releitura')
--    order by 1;                                      -- esperado: 4 linhas
--
-- b) o backfill cobriu o espelho
--   select count(*)                                          as laudos,
--          count(*) filter (where load_status_lido is null)   as sem_carimbo,
--          count(*) filter (where ausente_desde is not null)  as ausentes
--     from public.rec_laudos;         -- esperado: 756 · 0 · 0
--
-- c) A FILA DO PASSO B — o número que prova o desenho.
--    Esperado: 1 (o laudo 0000002149). Se vier 756, o BLOCO 2 não rodou.
--   select count(*) as fila_passo_b from public.rec_laudos
--    where enriquecido_em is null or precisa_releitura;
--
--   select numero, status, load_status_lido, resultado_analise,
--          load_resultado_lido, quantidade, quantidade_aprovada
--     from public.rec_laudos where precisa_releitura;
--
-- d) DEPOIS do deploy e do 1º disparo — o laudo 2149 deve ter sido corrigido:
--    quantidade_aprovada sai de 0 e os carimbos passam a bater com o status.
--   select numero, status, load_status_lido, resultado_analise,
--          quantidade, quantidade_aprovada, data_recepcao, precisa_releitura
--     from public.rec_laudos where numero='0000002149';
--
-- e) auditoria do run
--   select started_at, total_erros, observacao
--     from public.sync_runs where job_type='laudos'
--    order by started_at desc limit 1;
--   -- a observacao passa a trazer relidos_por_mudanca / ausentes / ausentes_limpos


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- ⚠ Só é seguro com a Edge Function ANTIGA no ar. Se a função nova estiver
-- publicada, derrubar `precisa_releitura` faz o passo B falhar inteiro (400 no
-- PostgREST) — reverta a função PRIMEIRO (Deploy da versão anterior), depois o
-- SQL. Nenhum dado de laudo é perdido: as colunas são todas aditivas.
--
--   drop index if exists public.rec_laudos_releitura_idx;
--   alter table public.rec_laudos
--     drop column if exists precisa_releitura,
--     drop column if exists load_status_lido,
--     drop column if exists load_resultado_lido,
--     drop column if exists ausente_desde;
--
-- Alternativa não destrutiva (mantém as colunas, desfaz só o backfill):
--   update public.rec_laudos set load_status_lido = null, load_resultado_lido = null;
--   -- ⚠ isto joga TODAS as 756 linhas na fila de releitura; ver BLOCO 2.
