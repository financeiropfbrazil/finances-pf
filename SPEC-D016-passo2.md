# SPEC-D016 — PASSO 2: `docfin-despesas.ts` (erp-proxy)

> **Repo:** `erp-proxy` — implementação e deploy do Pedro (regra 11).
> **Pré-requisito:** passo 1 aplicado ✅ (tabela `desp_docfin_orfaos` + RPC `desp_remover_orfaos_verificado`, grants conferidos, guarda testada em 20/07).
> **Efeito:** o motor grava o snapshot **na detecção** e **para de apagar por padrão**.

---

## O que muda, em uma frase

Onde hoje o código **identifica órfãos e apaga**, passa a: **gravar o snapshot → e só apagar se a flag explícita mandar**, via RPC (que verifica o snapshot dentro da transação).

---

## 1. Tipos (topo do arquivo, junto dos outros)

```ts
type OrfaoPolicy = {
  /** Default FALSE em todos os caminhos. Só rodada manual explícita liga. */
  permitirRemocao: boolean;
  /** 'cron' | 'manual_admin' | ... — vai para a auditoria. */
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
```

---

## 2. A função (substitui o bloco atual de limpeza)

```ts
/**
 * D-016 — Quarentena de órfãos: grava ANTES de apagar.
 * Invariante: nenhum doc é apagado sem snapshot já commitado (a RPC verifica).
 *
 * `chavesOrfas` = docs presentes no banco para a competência que a listagem
 * desta rodada NÃO trouxe (mesmo conjunto que a limpeza atual calcula).
 */
async function processarOrfaos(
  supabase: SupabaseClient,
  filial: string,
  competencia: string,            // 'YYYY-MM-01'
  chavesOrfas: number[],
  totalDocsNoBanco: number,
  policy: OrfaoPolicy,
): Promise<ResultadoOrfaos> {

  const r: ResultadoOrfaos = {
    detectados: 0, removidos: 0, emQuarentena: 0,
    abortadoPorTeto: false, valorRateioDetectado: 0, valorRateioRemovido: 0,
  };
  if (!chavesOrfas.length) return r;

  // ---------- 1. SNAPSHOT (o doc AINDA EXISTE aqui) ----------
  const { data: docs, error: eDocs } = await supabase
    .from('desp_docfin_doc').select('*')
    .eq('codigo_empresa_filial', filial)
    .in('chave_docfin', chavesOrfas);
  if (eDocs) throw new Error(`[D016] falha ao ler docs órfãos: ${eDocs.message}`);

  const { data: rats, error: eRats } = await supabase
    .from('desp_docfin_rateio').select('*')
    .eq('codigo_empresa_filial', filial)
    .in('chave_docfin', chavesOrfas);
  if (eRats) throw new Error(`[D016] falha ao ler rateios órfãos: ${eRats.message}`);

  const ratsPorChave = new Map<number, any[]>();
  for (const rt of rats ?? []) {
    const arr = ratsPorChave.get(rt.chave_docfin) ?? [];
    arr.push(rt);
    ratsPorChave.set(rt.chave_docfin, arr);
  }

  const agora = new Date().toISOString();

  const linhas = (docs ?? []).map((d: any) => {
    const rr = (ratsPorChave.get(d.chave_docfin) ?? []).sort(
      (a, b) => (a.ordem_classe - b.ordem_classe) || (a.ordem_rateio - b.ordem_rateio),
    );
    const total = rr.reduce((s, x) => s + Number(x.valor_brl ?? 0), 0);

    // ano/mes SEMPRE do rateio (armadilha 24). Sem rateio -> deriva da competência.
    const ano = rr[0]?.ano ?? Number(competencia.slice(0, 4));
    const mes = rr[0]?.mes ?? Number(competencia.slice(5, 7));

    r.valorRateioDetectado += total;

    return {
      codigo_empresa_filial: filial,
      chave_docfin: d.chave_docfin,
      competencia, ano, mes,
      especie: d.especie,
      numero: d.numero,
      codigo_entidade: d.codigo_entidade,
      nome_entidade: d.nome_entidade,
      valor_documento: d.valor_documento,
      valor_rateio_total: total,
      n_rateios: rr.length,
      data_emissao: d.data_emissao,
      codigo_situacao: d.codigo_situacao,
      sync_em_original: d.sync_em,
      doc_json: d,                      // inclui payload_alvo
      rateios_json: rr.length ? rr : null,
      status: 'DETECTADO',
      ultima_deteccao_em: agora,
      origem_rodada: policy.origemRodada,
      updated_at: agora,
    };
  });

  r.detectados = linhas.length;

  // ---------- 2. UPSERT na quarentena ----------
  // ignoreDuplicates:false => refresca snapshot e ultima_deteccao_em.
  // OBS: este upsert NÃO incrementa n_deteccoes nem preserva status —
  // ver "Ajuste do upsert" abaixo. Use a RPC de upsert se quiser as duas coisas.
  const { error: eUp } = await supabase
    .from('desp_docfin_orfaos')
    .upsert(linhas, {
      onConflict: 'codigo_empresa_filial,chave_docfin',
      ignoreDuplicates: false,
    });
  if (eUp) throw new Error(`[D016] falha ao gravar quarentena: ${eUp.message}`);

  console.log(
    `[D016] ORFAO_DETECTADO comp=${competencia} n=${r.detectados} ` +
    `rateio=${r.valorRateioDetectado.toFixed(2)} origem=${policy.origemRodada}`,
  );

  // ---------- 3. Remoção: SÓ com flag explícita ----------
  if (!policy.permitirRemocao) {
    r.emQuarentena = r.detectados;
    console.log(`[D016] remocao DESABILITADA (default) — ${r.detectados} doc(s) em quarentena, nada apagado`);
    return r;
  }

  // 3a. Teto (comportamento atual, mantido por cima da flag)
  const teto = Math.max(25, Math.floor(0.30 * totalDocsNoBanco));
  if (chavesOrfas.length > teto) {
    r.abortadoPorTeto = true;
    r.emQuarentena = r.detectados;
    console.error(`[D016] ABORTADO: ${chavesOrfas.length} órfãos > teto ${teto}. Nada apagado.`);
    return r;
  }

  // 3b. Deleção atômica e verificada (a transação vive no banco)
  const { data: del, error: eDel } = await supabase.rpc('desp_remover_orfaos_verificado', {
    p_filial: filial,
    p_chaves: chavesOrfas,
    p_origem: policy.origemRodada,
  });
  if (eDel) throw new Error(`[D016] falha na remoção verificada: ${eDel.message}`);

  r.removidos = del?.removidos ?? 0;
  r.valorRateioRemovido = Number(del?.valor_rateio ?? 0);
  r.emQuarentena = r.detectados - r.removidos;

  console.log(
    `[D016] ORFAO_REMOVIDO comp=${competencia} n=${r.removidos} ` +
    `rateio=${r.valorRateioRemovido.toFixed(2)}`,
  );
  return r;
}
```

---

## 3. Onde encaixar (integração)

### 3.1 Substituir a chamada da limpeza

```ts
// ANTES (conceitual): identifica órfãos e apaga direto
// await limparOrfaos(supabase, filial, chavesOrfas)

// DEPOIS:
const policy: OrfaoPolicy = {
  // ⚠️ === true explícito. NUNCA `?? true`, NUNCA `!== false`.
  // O campo ausente TEM de significar "não apagar" (armadilha 25).
  permitirRemocao: body?.permitir_remocao_orfaos === true,
  origemRodada: body?.trigger_source ?? 'cron',
};

const rOrfaos = await processarOrfaos(
  supabase, filial, competencia, chavesOrfas, totalDocsNoBanco, policy,
);
```

### 3.2 Propagar pela Edge Function

`sync-docfin-cron` repassa `permitir_remocao_orfaos` ao proxy **apenas se recebeu**. O pg_cron nunca envia esse campo — logo, rodada automática nunca apaga.

### 3.3 Somar ao `summary` / `sync_runs`

```ts
summary.orfaos_detectados        = rOrfaos.detectados;
summary.orfaos_removidos         = rOrfaos.removidos;
summary.orfaos_em_quarentena     = rOrfaos.emQuarentena;
summary.orfaos_abortado_por_teto = rOrfaos.abortadoPorTeto;
summary.orfaos_valor_detectado   = rOrfaos.valorRateioDetectado;
summary.orfaos_valor_removido    = rOrfaos.valorRateioRemovido;
```

Hoje o resultado da limpeza **não é auditável** em `sync_runs` — foi por isso que a remoção de junho passou despercebida.

---

## Ajuste do upsert (opcional, recomendado)

O `.upsert()` do cliente JS **sobrescreve** as colunas enviadas. Consequências:

* `n_deteccoes` **não incrementa** (fica sempre 1);
* `status` volta para `'DETECTADO'` mesmo em linha já `IGNORADO`/`REMOVIDO`/`RESTAURADO`.

Para o passo 2 isso é tolerável (o snapshot, que é o essencial, fica correto). Se quiser o comportamento pleno, trocar o `.upsert()` por esta RPC — aplicar **em execução própria**, pelo corpo `$$` (armadilha 34):

```sql
CREATE OR REPLACE FUNCTION public.desp_registrar_orfaos(p_linhas jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer := 0;
BEGIN
  INSERT INTO public.desp_docfin_orfaos AS o (
    codigo_empresa_filial, chave_docfin, competencia, ano, mes,
    especie, numero, codigo_entidade, nome_entidade, valor_documento,
    valor_rateio_total, n_rateios, data_emissao, codigo_situacao,
    sync_em_original, doc_json, rateios_json, origem_radada_tmp
  )
  SELECT x.codigo_empresa_filial, x.chave_docfin, x.competencia, x.ano, x.mes,
         x.especie, x.numero, x.codigo_entidade, x.nome_entidade, x.valor_documento,
         x.valor_rateio_total, x.n_rateios, x.data_emissao, x.codigo_situacao,
         x.sync_em_original, x.doc_json, x.rateios_json, x.origem_rodada
  FROM jsonb_populate_recordset(null::public.desp_docfin_orfaos, p_linhas) AS x
  ON CONFLICT (codigo_empresa_filial, chave_docfin) DO UPDATE
     SET ultima_deteccao_em = now(),
         n_deteccoes        = o.n_deteccoes + 1,   -- incrementa de verdade
         doc_json           = EXCLUDED.doc_json,   -- refresca o snapshot
         rateios_json       = EXCLUDED.rateios_json,
         valor_rateio_total = EXCLUDED.valor_rateio_total,
         updated_at         = now();
         -- status NÃO é tocado: preserva IGNORADO / REMOVIDO / RESTAURADO
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION public.desp_registrar_orfaos(jsonb) TO service_role;  -- armadilha 35
```

> ⚠️ Ajustar a lista de colunas ao aplicar (o `origem_rodada` foi grafado como placeholder acima). Se optar por esta RPC, o passo 2 chama `supabase.rpc('desp_registrar_orfaos', { p_linhas: linhas })` no lugar do `.upsert()`.

---

## Conferência depois do deploy (passo 3 — observar 1–2 dias)

```sql
-- deve ENCHER; removidos deve ficar em 0 enquanto a flag estiver desligada
SELECT status, count(*) docs, round(sum(valor_rateio_total),2) valor,
       min(primeira_deteccao_em) desde, max(ultima_deteccao_em) ate, max(n_deteccoes) max_det
  FROM public.desp_docfin_orfaos GROUP BY 1 ORDER BY 1;

-- por competência
SELECT ano, mes, status, count(*), round(sum(valor_rateio_total),2)
  FROM public.desp_docfin_orfaos GROUP BY 1,2,3 ORDER BY 1,2,3;

-- INVARIANTE: nada removido sem snapshot
SELECT count(*) AS violacoes
  FROM public.desp_docfin_orfaos WHERE status='REMOVIDO' AND doc_json IS NULL;  -- 0

-- o total do Hub não pode se mexer por causa disto
SELECT round(sum(valor_brl),2) FROM public.desp_docfin_rateio WHERE em_controle;
```

**Sinal de saúde:** as mesmas chaves reaparecendo a cada rodada (`n_deteccoes` subindo, se usar a RPC) e **`REMOVIDO` em zero**. Se aparecer `REMOVIDO`, uma flag vazou em algum caminho — investigar **antes** do passo 4.

**Passo 4** (habilitar a flag para backfill manual) só depois disso.
