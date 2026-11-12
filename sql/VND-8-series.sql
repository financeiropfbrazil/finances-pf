-- =====================================================================
-- VND-8 — número de série impresso das notas de saída (PLANO-VENDAS.md §19)
-- Ordem do Pedro em 12/11/2026 (desenho "Notas fiscais do Hub no Balancete",
-- etapa H1). Só ACRESCENTA: tabela de cadastro das séries, fila e 2 RPCs de
-- gravação usadas pela Edge sync-nf-saida-cron (service_role).
-- Nada existente é alterado. Rollback: sql/VND-8-series-rollback.sql
--
-- Por quê: a nota só traz o número de CONTROLE da série (ControleNumSerie);
-- o número impresso na peça (ex.: TSV05642) vem de NumSerie/Load (liberado
-- no erp-proxy, src/routes/alvo.ts). O Balancete P&F tem hoje as 4.023 séries
-- de 2026 com o número impresso (carga manual); sem isto, a busca automática
-- traria as séries sem o número.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint falhou: este não parece o projeto hbtggrbauguukewiknew';
  end if;
  if to_regclass('public.nf_saida_serie_cadastro') is not null then
    raise exception 'VND-8 já aplicado (nf_saida_serie_cadastro existe)';
  end if;
end $$;

-- 1. Cadastro: uma linha por número de controle já consultado no Alvo.
create table public.nf_saida_serie_cadastro (
  controle_num_serie bigint primary key,
  numero_serie       text,                 -- o número impresso na peça
  numero_ctrl_lote   text,
  codigo_produto     text,
  status             text not null check (status in ('ok', 'ausente', 'erro', 'estacionado')),
  tentativas         integer not null default 0,
  proxima_em         timestamptz,
  ultimo_erro        text,
  payload_alvo       jsonb,                -- resposta do NumSerie/Load, como veio
  lido_em            timestamptz,
  criado_em          timestamptz not null default now()
);
create index nf_saida_serie_cadastro_numero on public.nf_saida_serie_cadastro (upper(numero_serie));

-- 2. Fila: controles das notas que ainda não têm cadastro, ou cuja leitura falhou
--    e já pode ser tentada de novo. Os das notas mais recentes primeiro.
create view public.v_nf_saida_serie_fila with (security_invoker = true) as
select x.controle_num_serie as controle, max(s.data_emissao) as ultima_emissao
  from public.nf_saida_item_serie x
  join public.nf_saida s on s.id = x.nf_saida_id
  left join public.nf_saida_serie_cadastro c on c.controle_num_serie = x.controle_num_serie
 where c.controle_num_serie is null
    or (c.status = 'erro' and (c.proxima_em is null or c.proxima_em <= now()))
 group by x.controle_num_serie;

-- 3. Gravação (só a Edge, com a chave de serviço). Payload null = o Alvo não tem o controle.
create function public.nf_saida_serie_gravar(p_controle bigint, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_controle is null then
    raise exception 'controle obrigatório';
  end if;
  if p_payload is null then
    insert into nf_saida_serie_cadastro (controle_num_serie, status, tentativas, lido_em)
    values (p_controle, 'ausente', 0, now())
    on conflict (controle_num_serie) do update
      set status = 'ausente', tentativas = 0, proxima_em = null, ultimo_erro = null, lido_em = now();
    return jsonb_build_object('resultado', 'ausente');
  end if;
  insert into nf_saida_serie_cadastro (controle_num_serie, numero_serie, numero_ctrl_lote, codigo_produto,
                                       status, tentativas, payload_alvo, lido_em)
  values (p_controle,
          nullif(btrim(p_payload->>'NumeroSerie'), ''),
          nullif(btrim(p_payload->>'NumeroCtrlLote'), ''),
          nullif(btrim(p_payload->>'CodigoProduto'), ''),
          'ok', 0, p_payload, now())
  on conflict (controle_num_serie) do update
    set numero_serie     = excluded.numero_serie,
        numero_ctrl_lote = excluded.numero_ctrl_lote,
        codigo_produto   = excluded.codigo_produto,
        status           = 'ok',
        tentativas       = 0,
        proxima_em       = null,
        ultimo_erro      = null,
        payload_alvo     = excluded.payload_alvo,
        lido_em          = now();
  return jsonb_build_object('resultado', 'ok');
end;
$$;

-- Falha: mesma escada de esperas de nf_saida_registrar_falha (15 min, 1 h, 6 h, 24 h; estaciona na 5ª).
create function public.nf_saida_serie_registrar_falha(p_controle bigint, p_erro text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_t int; v_s text;
begin
  insert into nf_saida_serie_cadastro (controle_num_serie, status, tentativas, proxima_em, ultimo_erro)
  values (p_controle, 'erro', 1, now() + interval '15 minutes', left(coalesce(p_erro, '(sem mensagem)'), 2000))
  on conflict (controle_num_serie) do update
    set tentativas  = nf_saida_serie_cadastro.tentativas + 1,
        status      = case when nf_saida_serie_cadastro.tentativas + 1 >= 5 then 'estacionado' else 'erro' end,
        proxima_em  = now() + case nf_saida_serie_cadastro.tentativas + 1
                                when 1 then interval '15 minutes'
                                when 2 then interval '1 hour'
                                when 3 then interval '6 hours'
                                else interval '24 hours' end,
        ultimo_erro = left(coalesce(p_erro, '(sem mensagem)'), 2000)
  returning tentativas, status into v_t, v_s;
  return jsonb_build_object('tentativas', v_t, 'status', v_s);
end;
$$;

-- 4. Segurança: leitura só para admin (como as demais nf_saida*); gravação só pela Edge.
alter table public.nf_saida_serie_cadastro enable row level security;
create policy nf_saida_serie_cadastro_admin_select on public.nf_saida_serie_cadastro
  for select to authenticated using (_is_admin());

revoke all on public.nf_saida_serie_cadastro, public.v_nf_saida_serie_fila from anon;
revoke insert, update, delete, truncate, references, trigger
    on public.nf_saida_serie_cadastro, public.v_nf_saida_serie_fila from authenticated;
revoke select on public.v_nf_saida_serie_fila from authenticated;

revoke execute on function public.nf_saida_serie_gravar(bigint, jsonb)          from public, anon, authenticated;
revoke execute on function public.nf_saida_serie_registrar_falha(bigint, text)  from public, anon, authenticated;
grant  execute on function public.nf_saida_serie_gravar(bigint, jsonb)          to service_role;
grant  execute on function public.nf_saida_serie_registrar_falha(bigint, text)  to service_role;
