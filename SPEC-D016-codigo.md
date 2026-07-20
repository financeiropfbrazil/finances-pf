# SPEC-D016 — Código para implementação

> **Parte 1 (DDL):** aplicar no Supabase pelo SQL Editor. **Parte 2 (TypeScript):** colar no `erp-proxy` (repo do Pedro — o agente não toca, regra 11).
> Companion de `SPEC-D016-orfaos-auditoria.md` (desenho e justificativa).
>
> ⚠️ Este arquivo é **documentação**. O bloco TypeScript é para o **erp-proxy**, não para este repo — não criar `.ts` solto aqui, o build do Lovable é estrito (`noUnusedLocals`) e um arquivo órfão quebra o deploy.

---

## Parte 1 — DDL (Supabase, SQL Editor)

Aditivo e isolado: nenhuma tabela existente é alterada, nenhuma FK aponta para a nova.

```sql
-- ============================================================
-- D-016 — Quarentena/auditoria de órfãos do DocFin
-- Torna a deleção reversível POR CONSTRUÇÃO.
-- ============================================================
create table if not exists public.desp_docfin_orfaos (
  id                    uuid primary key default gen_random_uuid(),

  -- identificação
  codigo_empresa_filial text        not null,
  chave_docfin          bigint      not null,
  competencia           date        not null,
  ano                   integer     not null,   -- ano/mes DO RATEIO (armadilha 24)
  mes                   integer     not null,

  -- negócio (desnormalizado: consulta sem abrir o jsonb)
  especie               text,
  numero                text,
  codigo_entidade       text,
  nome_entidade         text,
  valor_documento       numeric,
  valor_rateio_total    numeric,                -- o que sai do total se removido
  n_rateios             integer,
  data_emissao          date,
  codigo_situacao       text,
  sync_em_original      timestamptz,

  -- SNAPSHOT COMPLETO — é isto que torna reversível
  doc_json              jsonb       not null,   -- to_jsonb(desp_docfin_doc), inclui payload_alvo
  rateios_json          jsonb,

  -- ciclo de vida
  status                text        not null default 'DETECTADO'
                        check (status in ('DETECTADO','REMOVIDO','RESTAURADO','IGNORADO')),
  primeira_deteccao_em  timestamptz not null default now(),
  ultima_deteccao_em    timestamptz not null default now(),
  n_deteccoes           integer     not null default 1,
  removido_em           timestamptz,
  removido_por          text,
  restaurado_em         timestamptz,
  origem_rodada         text,
  observacao            text,

  -- análise de gêmeo (preenchida por rotina/agente, nunca pelo motor)
  tem_gemeo             boolean,
  gemeo_fonte           text,
  gemeo_ref             text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_desp_docfin_orfaos unique (codigo_empresa_filial, chave_docfin)
);

create index if not exists ix_desp_orfaos_comp   on public.desp_docfin_orfaos (ano, mes);
create index if not exists ix_desp_orfaos_status on public.desp_docfin_orfaos (status);
create index if not exists ix_desp_orfaos_remov  on public.desp_docfin_orfaos (removido_em desc);

alter table public.desp_docfin_orfaos enable row level security;
-- sem policies: acesso só via RPC SECURITY DEFINER (armadilha 2)

comment on table public.desp_docfin_orfaos is
  'D-016: quarentena de docs órfãos do DocFin. Snapshot gravado NA DETECÇÃO (doc ainda existe), '
  'e a deleção só ocorre na mesma transação, após verificar que o snapshot está commitado.';
```

**Rollback:** `drop table public.desp_docfin_orfaos;` — isolada, sem dependentes.

### Conferência pós-DDL

```sql
select count(*) from public.desp_docfin_orfaos;                    -- 0
select relrowsecurity from pg_class where relname='desp_docfin_orfaos'; -- t
```

---

## Parte 2 — TypeScript (erp-proxy, `docfin-despesas`)

Módulo autocontido. Substitui o trecho atual que identifica órfãos e apaga.

```ts
// ============================================================
// D-016 — Quarentena de órfãos: gravar ANTES de apagar.
// Invariante: nenhum doc é apagado sem snapshot já commitado.
// ============================================================

type OrfaoPolicy = {
  /** Default FALSE em todos os caminhos. Só rodada manual explícita liga. */
  permitirRemocao: boolean;
  /** 'cron' | 'manual_admin' | ... — vai para auditoria. */
  origemRodada: string;
};

type ResultadoOrfaos = {
  detectados: number;
  removidos: number;
  emQuarentena: number;
  abortadoPorTeto: boolean;
  valorRateioDetectado: number;
  valorRateioRemovido: number;
};

/**
 * Chamada no lugar da limpeza atual, depois de calcular `chavesOrfas`
 * (docs no banco para a competência que a listagem da rodada NÃO trouxe).
 */
async function processarOrfaos(
  supabase: SupabaseClient,
  filial: string,
  competencia: string,          // 'YYYY-MM-01'
  chavesOrfas: number[],
  totalDocsNoBanco: number,
  policy: OrfaoPolicy,
): Promise<ResultadoOrfaos> {

  const r: ResultadoOrfaos = {
    detectados: 0, removidos: 0, emQuarentena: 0,
    abortadoPorTeto: false, valorRateioDetectado: 0, valorRateioRemovido: 0,
  };
  if (chavesOrfas.length === 0) return r;

  // ---------- 1. SNAPSHOT (doc ainda existe) ----------
  const { data: docs, error: eDocs } = await supabase
    .from('desp_docfin_doc').select('*')
    .eq('codigo_empresa_filial', filial).in('chave_docfin', chavesOrfas);
  if (eDocs) throw new Error(`[D016] falha ao ler docs órfãos: ${eDocs.message}`);

  const { data: rats, error: eRats } = await supabase
    .from('desp_docfin_rateio').select('*')
    .eq('codigo_empresa_filial', filial).in('chave_docfin', chavesOrfas);
  if (eRats) throw new Error(`[D016] falha ao ler rateios órfãos: ${eRats.message}`);

  const ratsPorChave = new Map<number, any[]>();
  for (const rt of rats ?? []) {
    const arr = ratsPorChave.get(rt.chave_docfin) ?? [];
    arr.push(rt); ratsPorChave.set(rt.chave_docfin, arr);
  }

  const linhas = (docs ?? []).map((d) => {
    const rr = (ratsPorChave.get(d.chave_docfin) ?? [])
      .sort((a, b) => (a.ordem_classe - b.ordem_classe) || (a.ordem_rateio - b.ordem_rateio));
    const total = rr.reduce((s, x) => s + Number(x.valor_brl ?? 0), 0);

    // ano/mes SEMPRE do rateio (armadilha 24). Sem rateio -> deriva da competência.
    const ano = rr[0]?.ano ?? Number(competencia.slice(0, 4));
    const mes = rr[0]?.mes ?? Number(competencia.slice(5, 7));

    r.valorRateioDetectado += total;
    return {
      codigo_empresa_filial: filial,
      chave_docfin: d.chave_docfin,
      competencia, ano, mes,
      especie: d.especie, numero: d.numero,
      codigo_entidade: d.codigo_entidade, nome_entidade: d.nome_entidade,
      valor_documento: d.valor_documento,
      valor_rateio_total: total, n_rateios: rr.length,
      data_emissao: d.data_emissao, codigo_situacao: d.codigo_situacao,
      sync_em_original: d.sync_em,
      doc_json: d,                            // inclui payload_alvo
      rateios_json: rr.length ? rr : null,
      status: 'DETECTADO',
      ultima_deteccao_em: new Date().toISOString(),
      origem_rodada: policy.origemRodada,
      updated_at: new Date().toISOString(),
    };
  });

  r.detectados = linhas.length;

  // ---------- 2. UPSERT na quarentena ----------
  // ignoreDuplicates:false => atualiza snapshot e ultima_deteccao_em.
  // `status` NÃO é sobrescrito para REMOVIDO/IGNORADO/RESTAURADO: ver RPC abaixo.
  const { error: eUp } = await supabase
    .from('desp_docfin_orfaos')
    .upsert(linhas, { onConflict: 'codigo_empresa_filial,chave_docfin', ignoreDuplicates: false });
  if (eUp) throw new Error(`[D016] falha ao gravar quarentena: ${eUp.message}`);

  console.log(`[D016] ORFAO_DETECTADO comp=${competencia} n=${r.detectados} ` +
              `rateio=${r.valorRateioDetectado.toFixed(2)} origem=${policy.origemRodada}`);

  // ---------- 3. Remoção: só com flag explícita ----------
  if (!policy.permitirRemocao) {
    r.emQuarentena = r.detectados;
    console.log(`[D016] remocao DESABILITADA (default) — ${r.detectados} doc(s) em quarentena, nada apagado`);
    return r;
  }

  // 3a. Teto (comportamento atual, mantido)
  const teto = Math.max(25, Math.floor(0.30 * totalDocsNoBanco));
  if (chavesOrfas.length > teto) {
    r.abortadoPorTeto = true; r.emQuarentena = r.detectados;
    console.error(`[D016] ABORTADO: ${chavesOrfas.length} órfãos > teto ${teto}. Nada apagado.`);
    return r;
  }

  // 3b. Deleção verificada e atômica (RPC — o cliente JS não abre transação)
  const { data: del, error: eDel } = await supabase.rpc('desp_remover_orfaos_verificado', {
    p_filial: filial,
    p_chaves: chavesOrfas,
    p_origem: policy.origemRodada,
  });
  if (eDel) throw new Error(`[D016] falha na remoção verificada: ${eDel.message}`);

  r.removidos = del?.removidos ?? 0;
  r.valorRateioRemovido = Number(del?.valor_rateio ?? 0);
  r.emQuarentena = r.detectados - r.removidos;
  console.log(`[D016] ORFAO_REMOVIDO comp=${competencia} n=${r.removidos} ` +
              `rateio=${r.valorRateioRemovido.toFixed(2)}`);
  return r;
}
```

### RPC da deleção atômica (SQL — aplicar junto com o DDL)

O cliente JS do Supabase **não abre transação**; a atomicidade tem de viver no banco.

```sql
create or replace function public.desp_remover_orfaos_verificado(
  p_filial text, p_chaves bigint[], p_origem text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sem_snapshot bigint[];
  v_removidos int := 0;
  v_valor numeric := 0;
begin
  -- GUARDA: nenhuma chave pode ser apagada sem snapshot commitado e não-nulo
  select array_agg(c) into v_sem_snapshot
  from unnest(p_chaves) c
  where not exists (
    select 1 from public.desp_docfin_orfaos o
    where o.codigo_empresa_filial = p_filial
      and o.chave_docfin = c
      and o.doc_json is not null
  );

  if v_sem_snapshot is not null then
    raise exception 'D016: % chave(s) sem snapshot — remocao abortada: %',
      array_length(v_sem_snapshot,1), v_sem_snapshot;
  end if;

  select coalesce(sum(valor_brl),0) into v_valor
  from public.desp_docfin_rateio
  where codigo_empresa_filial = p_filial and chave_docfin = any(p_chaves);

  delete from public.desp_docfin_rateio
   where codigo_empresa_filial = p_filial and chave_docfin = any(p_chaves);

  delete from public.desp_docfin_doc
   where codigo_empresa_filial = p_filial and chave_docfin = any(p_chaves);
  get diagnostics v_removidos = row_count;

  update public.desp_docfin_orfaos
     set status='REMOVIDO', removido_em=now(), removido_por=p_origem,
         origem_rodada=p_origem, updated_at=now()
   where codigo_empresa_filial = p_filial and chave_docfin = any(p_chaves)
     and status <> 'REMOVIDO';

  return jsonb_build_object('removidos', v_removidos, 'valor_rateio', v_valor);
end $$;

revoke all on function public.desp_remover_orfaos_verificado(text, bigint[], text) from public, anon, authenticated;
```

Tudo dentro da função roda em **uma transação**: se a guarda dispara, nada é apagado. Se o DELETE do doc falhar, o DELETE dos rateios reverte junto.

### Integração — o que mudar em volta

1. **Assinatura da chamada.** Onde hoje a limpeza é invocada, passar a policy com **default seguro**:
   ```ts
   const policy: OrfaoPolicy = {
     permitirRemocao: body?.permitir_remocao_orfaos === true,  // nunca `?? true`
     origemRodada: body?.trigger_source ?? 'cron',
   };
   ```
   Nunca derivar de `!== false` nem herdar de default — é o mesmo erro que a armadilha 25 pegou no `em_controle`.

2. **Propagar pela Edge Function.** `sync-docfin-cron` repassa `permitir_remocao_orfaos` ao proxy; ausente ⇒ `false`. O pg_cron nunca envia esse campo.

3. **`summary` / `sync_runs`.** Somar `orfaos_detectados`, `orfaos_removidos`, `orfaos_em_quarentena`, `orfaos_abortado_por_teto`. Hoje o resultado da limpeza não é auditável em `sync_runs`.

---

## Parte 3 — Conferência após o passo 2 (parar de apagar)

```sql
-- deve encher; removidos deve permanecer 0 enquanto a flag estiver desligada
select status, count(*) docs, round(sum(valor_rateio_total),2) valor,
       min(primeira_deteccao_em) desde, max(ultima_deteccao_em) ate, max(n_deteccoes) max_det
from public.desp_docfin_orfaos group by 1 order by 1;

-- por competência
select ano, mes, status, count(*), round(sum(valor_rateio_total),2)
from public.desp_docfin_orfaos group by 1,2,3 order by 1,2,3;

-- INVARIANTE: nada removido sem snapshot
select count(*) as violacoes
from public.desp_docfin_orfaos where status='REMOVIDO' and doc_json is null;  -- deve ser 0
```

**Sinal de saúde nos primeiros dias:** `n_deteccoes` cresce nas mesmas chaves (o mesmo órfão é re-detectado a cada rodada) e `REMOVIDO` fica em zero. Se aparecer `REMOVIDO`, alguma flag vazou — investigar antes de seguir.

## Parte 4 — Restauração (opcional, quando houver necessidade)

```sql
create or replace function public.desp_restaurar_orfao(p_filial text, p_chave bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_o record; v_n int := 0;
begin
  if not public.user_has_permission('despesas.admin') then
    raise exception 'Sem permissao';
  end if;

  select * into v_o from public.desp_docfin_orfaos
   where codigo_empresa_filial=p_filial and chave_docfin=p_chave;
  if not found then raise exception 'Orfao nao encontrado'; end if;
  if v_o.doc_json is null then raise exception 'Sem snapshot'; end if;

  insert into public.desp_docfin_doc
  select * from jsonb_populate_record(null::public.desp_docfin_doc, v_o.doc_json)
  on conflict do nothing;

  if v_o.rateios_json is not null then
    insert into public.desp_docfin_rateio
    select * from jsonb_populate_recordset(null::public.desp_docfin_rateio, v_o.rateios_json)
    on conflict do nothing;
    get diagnostics v_n = row_count;
  end if;

  update public.desp_docfin_orfaos
     set status='RESTAURADO', restaurado_em=now(), updated_at=now()
   where codigo_empresa_filial=p_filial and chave_docfin=p_chave;

  return jsonb_build_object('doc', 1, 'rateios', v_n);
end $$;
```

⚠️ Restaurar em competência **FECHADA** dispara `desp_bloqueia_rateio_fechado` (regra 5) — o erro é correto, não contornar.
