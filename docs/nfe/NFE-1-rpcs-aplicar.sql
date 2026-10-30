-- =====================================================================
-- NFE-1 — RPCs de escrita da tela de Notas Fiscais (PLANO-NFE.md) — 30/10/2026
-- Projeto: hbtggrbauguukewiknew.
-- Por quê: a tela grava direto nas tabelas (upload de XML = insert; vincular/desvincular = upsert da linha inteira e
-- delete/insert em compras_nfe_pedidos). Para a NFE-2 fechar as tabelas, essas 3 escritas passam para RPCs com gate.
-- O QUE CRIA (só funções novas; nenhuma tabela muda):
--   1. compras_nfe_importar_xml(p_nota jsonb, p_xml text)  — upload manual (origem 'Upload'), dedup por chave
--   2. compras_nfe_vincular_pedidos(p_nfe_id uuid, p_pedidos jsonb) — 1º = principal; colunas legadas + compras_nfe_pedidos
--      + compras_pedidos.nf_vinculada (o mesmo que o diálogo fazia)
--   3. compras_nfe_desvincular(p_nfe_id uuid) — limpa as colunas legadas E os vínculos de compras_nfe_pedidos
--      (antes ficavam órfãos)
-- Gate: nfe_pode_gravar() (admin ou compras.nfe.create). Sem permissão = 42501.
-- NÃO toca a entrada da Riosoft (Edge receber-nfe, chave de serviço).
-- Rollback: NFE-1-rpcs-rollback.sql.
-- STATUS (30/10/2026): AINDA NÃO APLICADO — a 1ª tentativa pelo MCP parou na confirmação do servidor sem resposta;
-- conferido em pg_proc: nenhuma das 3 funções existe.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regprocedure('public.nfe_pode_gravar()') is null then
    raise exception 'NFE-0 não aplicada (falta nfe_pode_gravar)';
  end if;
  if to_regprocedure('public.compras_nfe_importar_xml(jsonb,text)') is not null
     or to_regprocedure('public.compras_nfe_vincular_pedidos(uuid,jsonb)') is not null
     or to_regprocedure('public.compras_nfe_desvincular(uuid)') is not null then
    raise exception 'RPCs da NFE-1 já existem — conferir antes de aplicar';
  end if;
end $$;

-- ── 1. Upload manual de XML ──────────────────────────────────────────
-- p_nota: o objeto do parseNfeXml (front) — só os campos abaixo são lidos; p_xml: o XML original.
create function public.compras_nfe_importar_xml(p_nota jsonb, p_xml text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_chave text := regexp_replace(coalesce(p_nota->>'chave_acesso', ''), '\D', '', 'g');
  v_id    uuid;
  v_data  date;
  n       numeric;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.nfe_pode_gravar() then
    raise exception 'Sem permissão para importar NF-e' using errcode = '42501';
  end if;
  if v_chave !~ '^[0-9]{44}$' then
    return jsonb_build_object('status', 'erro', 'mensagem', 'Chave de acesso inválida (esperado 44 dígitos).');
  end if;
  if p_xml is null or length(p_xml) > 5242880 or position(v_chave in p_xml) = 0 then
    return jsonb_build_object('status', 'erro', 'mensagem', 'O XML não confere com a chave de acesso (ou passa de 5 MB).');
  end if;

  select id into v_id from public.compras_nfe where chave_acesso = v_chave;
  if v_id is not null then
    return jsonb_build_object('status', 'duplicada', 'id', v_id, 'chave_acesso', v_chave);
  end if;

  begin
    v_data := left(p_nota->>'data_emissao', 10)::date;
  exception when others then
    v_data := null;
  end;

  begin
    insert into public.compras_nfe (
      tipo_documento, modelo, chave_acesso, numero, serie, data_emissao, natureza_operacao,
      emitente_cnpj, emitente_nome,
      valor_produtos, valor_frete, valor_seguro, valor_desconto, valor_outras_despesas,
      base_calculo_icms, valor_icms, base_icms_st, valor_icms_st, valor_ipi, valor_ii, valor_pis, valor_cofins,
      valor_fcp, valor_total,
      origem, raw_xml, dados_extraidos, created_by)
    values (
      'NFe', p_nota->>'modelo', v_chave, p_nota->>'numero', p_nota->>'serie', v_data, p_nota->>'natureza_operacao',
      p_nota->>'emitente_cnpj', p_nota->>'emitente_nome',
      nullif(p_nota->>'valor_produtos', '')::numeric, nullif(p_nota->>'valor_frete', '')::numeric,
      nullif(p_nota->>'valor_seguro', '')::numeric, nullif(p_nota->>'valor_desconto', '')::numeric,
      nullif(p_nota->>'valor_outras_despesas', '')::numeric,
      nullif(p_nota->>'base_calculo_icms', '')::numeric, nullif(p_nota->>'valor_icms', '')::numeric,
      nullif(p_nota->>'base_icms_st', '')::numeric, nullif(p_nota->>'valor_icms_st', '')::numeric,
      nullif(p_nota->>'valor_ipi', '')::numeric, nullif(p_nota->>'valor_ii', '')::numeric,
      nullif(p_nota->>'valor_pis', '')::numeric, nullif(p_nota->>'valor_cofins', '')::numeric,
      nullif(p_nota->>'valor_fcp', '')::numeric, nullif(p_nota->>'valor_total', '')::numeric,
      'Upload', p_xml,
      jsonb_build_object('itens', case when jsonb_typeof(p_nota->'itens') = 'array' then p_nota->'itens' else '[]'::jsonb end),
      auth.uid())
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.compras_nfe where chave_acesso = v_chave;
    return jsonb_build_object('status', 'duplicada', 'id', v_id, 'chave_acesso', v_chave);
  end;

  return jsonb_build_object('status', 'importada', 'id', v_id, 'chave_acesso', v_chave);
end;
$$;

-- ── 2. Vincular pedidos (multi-seleção; o 1º é o principal) ───────────
-- p_pedidos: [{"numero": "0005123", "codigo_empresa_filial": "1.01"}, ...] na ordem da tela.
create function public.compras_nfe_vincular_pedidos(p_nfe_id uuid, p_pedidos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_principal record;
  v_n         integer;
  v_faltando  text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.nfe_pode_gravar() then
    raise exception 'Sem permissão para vincular pedido à NF-e' using errcode = '42501';
  end if;
  if not exists (select 1 from public.compras_nfe where id = p_nfe_id) then
    return jsonb_build_object('success', false, 'mensagem', 'NF-e não encontrada.');
  end if;
  if jsonb_typeof(p_pedidos) <> 'array' or jsonb_array_length(p_pedidos) = 0 then
    return jsonb_build_object('success', false, 'mensagem', 'Nenhum pedido selecionado.');
  end if;

  select string_agg(x->>'numero', ', ') into v_faltando
    from jsonb_array_elements(p_pedidos) x
   where not exists (select 1 from public.compras_pedidos cp
                      where cp.numero = x->>'numero'
                        and cp.codigo_empresa_filial = coalesce(nullif(x->>'codigo_empresa_filial', ''), '1.01'));
  if v_faltando is not null then
    return jsonb_build_object('success', false, 'mensagem', 'Pedido(s) não encontrado(s): ' || v_faltando);
  end if;

  perform pg_advisory_xact_lock(hashtext('compras_nfe_vinculo:' || p_nfe_id::text));

  select cp.* into v_principal
    from public.compras_pedidos cp
   where cp.numero = p_pedidos->0->>'numero'
     and cp.codigo_empresa_filial = coalesce(nullif(p_pedidos->0->>'codigo_empresa_filial', ''), '1.01');

  update public.compras_nfe
     set status_lancamento = 'vinculada',
         pedido_compra_numero = v_principal.numero,
         pedido_compra_entidade = v_principal.codigo_entidade,
         pedido_compra_classe = nullif(v_principal.classe_rec_desp, ''),
         pedido_compra_centro_custo = nullif(v_principal.centro_custo, ''),
         pedido_compra_cond_pagamento = case when nullif(v_principal.codigo_cond_pag, '') is null then null
                                             else v_principal.codigo_cond_pag
                                                  || coalesce(' (' || nullif(v_principal.nome_cond_pag, '') || ')', '') end,
         pedido_compra_valor = v_principal.valor_total,
         updated_at = now()
   where id = p_nfe_id;

  delete from public.compras_nfe_pedidos where nfe_id = p_nfe_id;
  insert into public.compras_nfe_pedidos (nfe_id, pedido_numero, codigo_empresa_filial, is_principal, created_by)
  select p_nfe_id, x->>'numero', coalesce(nullif(x->>'codigo_empresa_filial', ''), '1.01'), o = 1, auth.uid()
    from jsonb_array_elements(p_pedidos) with ordinality as t(x, o)
  on conflict (nfe_id, pedido_numero, codigo_empresa_filial) do nothing;
  get diagnostics v_n = row_count;

  update public.compras_pedidos cp
     set nf_vinculada = true, nf_vinculada_em = now(), nf_vinculada_tipo = 'compras_nfe'
    from jsonb_array_elements(p_pedidos) x
   where cp.numero = x->>'numero'
     and cp.codigo_empresa_filial = coalesce(nullif(x->>'codigo_empresa_filial', ''), '1.01');

  return jsonb_build_object('success', true, 'vinculos', v_n, 'principal', v_principal.numero);
end;
$$;

-- ── 3. Desvincular ────────────────────────────────────────────────────
create function public.compras_nfe_desvincular(p_nfe_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.nfe_pode_gravar() then
    raise exception 'Sem permissão para desvincular pedido da NF-e' using errcode = '42501';
  end if;
  update public.compras_nfe
     set status_lancamento = 'pendente',
         pedido_compra_numero = null, pedido_compra_entidade = null, pedido_compra_classe = null,
         pedido_compra_centro_custo = null, pedido_compra_cond_pagamento = null, pedido_compra_valor = null,
         updated_at = now()
   where id = p_nfe_id and status_lancamento = 'vinculada';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('success', false, 'mensagem', 'NF-e não encontrada ou sem pedido vinculado.');
  end if;
  delete from public.compras_nfe_pedidos where nfe_id = p_nfe_id;
  return jsonb_build_object('success', true);
end;
$$;

comment on function public.compras_nfe_importar_xml(jsonb, text) is
  'NFE-1: upload manual de XML de NF-e (origem Upload), dedup por chave. Gate nfe_pode_gravar(). A entrada da Riosoft é a Edge receber-nfe.';
comment on function public.compras_nfe_vincular_pedidos(uuid, jsonb) is
  'NFE-1: vincula NF-e a pedidos (1º = principal): colunas legadas de compras_nfe, compras_nfe_pedidos e compras_pedidos.nf_vinculada. Gate nfe_pode_gravar().';
comment on function public.compras_nfe_desvincular(uuid) is
  'NFE-1: tira o vínculo de pedido da NF-e (colunas legadas e compras_nfe_pedidos). Gate nfe_pode_gravar().';

-- ── 4. Privilégios: função nova nasce com EXECUTE nominal para anon (CLAUDE.md) ──
revoke execute on function public.compras_nfe_importar_xml(jsonb, text) from public, anon;
revoke execute on function public.compras_nfe_vincular_pedidos(uuid, jsonb) from public, anon;
revoke execute on function public.compras_nfe_desvincular(uuid) from public, anon;
grant execute on function public.compras_nfe_importar_xml(jsonb, text) to authenticated;
grant execute on function public.compras_nfe_vincular_pedidos(uuid, jsonb) to authenticated;
grant execute on function public.compras_nfe_desvincular(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.compras_nfe_importar_xml(jsonb, text)', 'execute')
     or has_function_privilege('anon', 'public.compras_nfe_vincular_pedidos(uuid, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.compras_nfe_desvincular(uuid)', 'execute') then
    raise exception 'ACESSOS: anon ficou com EXECUTE. Transação desfeita.';
  end if;
end $$;
