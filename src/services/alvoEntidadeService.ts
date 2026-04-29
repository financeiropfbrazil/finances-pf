import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Filtro de fornecedor (mesma regra usada na tela do Alvo)
const FILTRO_FORNECEDOR =
  "( CodigoStatEnt IN ('01','02','11','03','09','04','05','10','06','07','08') &&  Entidade1Query[ EntCategQuery [ CodigoCategoria like '002%'] ])";

/**
 * Mapeia 1 registro do GetListForComponents para o formato do banco.
 * Aproveita TODOS os campos que vêm sem custo extra (header + Entidade1Object).
 */
function mapEntidadeToRecord(e: any) {
  const ent1 = e.Entidade1Object || {};
  return {
    // Identificação
    codigo_entidade: e.Codigo,
    codigo_alternativo: e.CodigoAlternativo,
    cnpj: e.CPFCNPJ,
    nome: e.Nome || e.NomeFantasia || "",
    nome_fantasia: e.NomeFantasia,
    ie: e.RGIE,
    inscricao_municipal: e.InscricaoMunicipal,
    tipo_pessoa: e.Tipo, // "Jurídica" / "Física"

    // Endereço
    cep: e.Cep,
    tipo_logradouro: e.CodigoTipoLograd,
    endereco: e.Endereco,
    numero_endereco: e.NumeroEndereco,
    complemento_endereco: e.ComplementoEndereco,
    bairro: e.Bairro,
    codigo_cidade_alvo: e.CodigoCidade,

    // Status
    codigo_stat_ent: e.CodigoStatEnt, // "01" = Ativo

    // Datas
    entidade_desde: e.EntidadeDesde || null,
    data_cadastro_alvo: e.DataCadastro || null,
    data_fundacao: e.DataFundacao || null,
    data_situacao_cadastral_federal: ent1.DataSituacaoCadastralFederal || null,

    // Tributário
    optante_simples_federal: e.OptanteSimplesFederal,

    // Bancário
    numero_banco_deposito: e.NumeroBancoDeposito,
    numero_agencia_deposito: e.NumeroAgenciaDeposito,
    numero_conta_deposito: ent1.NumeroContaDeposito,
    tipo_chave_pix: ent1.TipoChavePIX,
    chave_pix: ent1.ChavePIX || null,
    tipo_chave_pix_deposito: ent1.TipoChavePIXDeposito,
    chave_pix_deposito: ent1.ChavePIXDeposito || null,
    codigo_iban: ent1.CodigoIBAN,

    // Flags
    grupo_alvo: ent1.Grupo,
    entidade_motorista: ent1.EntidadeMotorista,
    entidade_transportador: ent1.EntidadeTransportador,
    microempreendedor_individual: ent1.MicroEmpreendedorIndividual,
    possui_penhora_judicial: ent1.PossuiPenhoraJudicial,

    // Auditoria
    updated_at: new Date().toISOString(),
  };
}

/**
 * Faz uma chamada paginada ao GetListForComponents com retry de auth (409).
 */
async function fetchPageEntidades(
  page: number,
  pageSize: number,
  filter: string,
  tokenRef: { token: string },
): Promise<any[]> {
  let resp: Response | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    resp = await fetch(`${ERP_BASE_URL}/Entidade/GetListForComponents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": tokenRef.token,
      },
      body: JSON.stringify({
        FormName: "entidade",
        ClassInput: "Entidade",
        ControllerForm: "entidade",
        TypeObject: "tabForm",
        Filter: filter,
        Input: "gridTableEntidade",
        IsGroupBy: false,
        Order: "Nome ASC",
        PageIndex: page,
        PageSize: pageSize,
        Shortcut: "entidade",
        Type: "GridTable",
      }),
    });

    if (resp && resp.status === 409) {
      clearAlvoToken();
      await delay(1000 * attempt);
      const auth = await authenticateAlvo();
      if (auth.token) tokenRef.token = auth.token;
      continue;
    }
    break;
  }

  if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

/**
 * FASE 1 — Sync amplo: traz TODAS as entidades (sem filtro) com todos campos
 * disponíveis no GetListForComponents. Faz upsert no cache.
 */
async function syncEntidadesAmplo(tokenRef: { token: string }, onProgress?: (msg: string) => void): Promise<number> {
  let page = 1;
  let totalSaved = 0;
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Buscando entidades... página ${page}`);
    const data = await fetchPageEntidades(page, PAGE_SIZE, "", tokenRef);

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    const records = data.filter((e: any) => e.Codigo && e.CPFCNPJ).map(mapEntidadeToRecord);

    if (records.length > 0) {
      const { error } = await supabase
        .from("compras_entidades_cache")
        .upsert(records as any, { onConflict: "codigo_entidade" });

      if (error) console.warn(`[Entidade] Erro upsert page ${page}:`, error.message);
      else totalSaved += records.length;
    }

    onProgress?.(`${totalSaved} entidades sincronizadas...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  return totalSaved;
}

/**
 * FASE 2 — Marca fornecedores: roda com filtro CodigoCategoria=002%
 * e atualiza e_fornecedor=true. Depois zera flag das entidades que
 * não estão mais nessa categoria.
 */
async function marcarFornecedores(tokenRef: { token: string }, onProgress?: (msg: string) => void): Promise<number> {
  let page = 1;
  const codigosFornecedores: string[] = [];
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Identificando fornecedores... página ${page}`);
    const data = await fetchPageEntidades(page, PAGE_SIZE, FILTRO_FORNECEDOR, tokenRef);

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    const codigos = data.filter((e: any) => e.Codigo).map((e: any) => e.Codigo as string);

    codigosFornecedores.push(...codigos);
    onProgress?.(`${codigosFornecedores.length} fornecedores identificados...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  if (codigosFornecedores.length === 0) return 0;

  // Marca e_fornecedor = true (em batches de 500 pra evitar URL gigante no .in())
  const BATCH = 500;
  let totalMarcados = 0;
  const sb = supabase as any;

  for (let i = 0; i < codigosFornecedores.length; i += BATCH) {
    const batch = codigosFornecedores.slice(i, i + BATCH);
    const { error, count } = await sb
      .from("compras_entidades_cache")
      .update({ e_fornecedor: true }, { count: "exact" })
      .in("codigo_entidade", batch);

    if (error) console.warn(`[Fornecedor] Erro batch ${i}:`, error.message);
    else totalMarcados += count || 0;
  }

  // Zera flag das que NÃO estão mais na lista de fornecedores
  const fornecedoresInClause = `(${codigosFornecedores.map((c) => `"${c}"`).join(",")})`;
  const { error: errResetar } = await sb
    .from("compras_entidades_cache")
    .update({ e_fornecedor: false })
    .eq("e_fornecedor", true)
    .not("codigo_entidade", "in", fornecedoresInClause);

  if (errResetar) {
    console.warn(`[Fornecedor] Reset via .not(in) falhou: ${errResetar.message}`);
  }

  return totalMarcados;
}

/**
 * Sync principal: roda Fase 1 (amplo) + Fase 2 (marcar fornecedores).
 * Mantém compatibilidade com o botão atual do Settings.
 */
export async function syncEntidades(onProgress?: (msg: string) => void): Promise<number> {
  clearAlvoToken();
  const auth = await authenticateAlvo();
  if (!auth.token) throw new Error("Falha na autenticação ERP");

  const tokenRef = { token: auth.token };

  // FASE 1 — sync amplo
  onProgress?.("Fase 1/2: sincronizando entidades...");
  const totalAmplo = await syncEntidadesAmplo(tokenRef, onProgress);

  // FASE 2 — marcar fornecedores
  onProgress?.("Fase 2/2: marcando fornecedores...");
  const totalFornecedores = await marcarFornecedores(tokenRef, onProgress);

  // Salvar metadata
  await supabase.from("compras_config").upsert(
    {
      chave: "sync_entidades_ts",
      valor: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" },
  );

  await supabase.from("compras_config").upsert(
    {
      chave: "sync_entidades_count",
      valor: String(totalAmplo),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" },
  );

  await supabase.from("compras_config").upsert(
    {
      chave: "sync_fornecedores_count",
      valor: String(totalFornecedores),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" },
  );

  onProgress?.(`Concluído: ${totalAmplo} entidades, ${totalFornecedores} fornecedores marcados`);
  return totalAmplo;
}
