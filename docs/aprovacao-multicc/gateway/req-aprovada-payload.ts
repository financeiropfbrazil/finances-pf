import { exigirQuantidadesCompletas } from "./req-unidades";
// Este mapper recebe exclusivamente o snapshot retornado pela RPC service_role.
export interface SnapshotEnvio {
  token: string;
  codigo_usuario: string;
  requisicao: {
    codigo_empresa_filial: string; codigo_centro_ctrl: string; codigo_funcionario: string;
    codigo_finalidade_compra: string; data_necessidade: string; descricao: string; texto: string;
  };
  itens: Array<{
    codigo_centro_ctrl: string; codigo_produto: string; codigo_alternativo_produto: string | null;
    codigo_prod_unid_med: string; quantidade_solicitada: number; posicao_prod_unid_med: number; quantidade: number; item_servico: boolean; observacao: string;
  }>;
  rateio: Array<{ codigo_classe_rec_desp: string; percentual: number;
    ccs: Array<{ codigo_centro_ctrl: string; percentual: number }> }>;
  arquivos: Array<{ upload_identify_guid: string; storage_path: string; nome_original: string; conteudo_sha256?: string }>;
}

// O mapper só preserva a tupla congelada. O handler valida com Produto/Load fresco.
export function quantidadeUnidade(i: SnapshotEnvio["itens"][number]) {
  exigirQuantidadesCompletas(i);
  return { PosicaoProdUnidMed: i.posicao_prod_unid_med, Quantidade2: Number(i.quantidade_solicitada), QuantidadeProdUnidMedPrincipal: Number(i.quantidade) };
}

export function montarReqAprovada(s: SnapshotEnvio) {
  const r = s.requisicao;
  if (!s.itens?.length) throw new Error("Requisição sem itens");
  const data = `${r.data_necessidade.substring(0, 10)}T00:00:00-03:00`;
  return {
    CodigoEmpresaFilial: r.codigo_empresa_filial, CodigoEmpresaFilialOrigem: r.codigo_empresa_filial,
    CodigoUsuario: s.codigo_usuario, UsuarioLogado: s.codigo_usuario, Numero: "",
    CodigoCentroCtrl: r.codigo_centro_ctrl, CodigoFuncionario: r.codigo_funcionario,
    CodigoFinalidadeCompra: r.codigo_finalidade_compra, DataNecessidade: data,
    Descricao: (r.descricao || "").slice(0, 100), Texto: r.texto || "",
    ItemReqCompChildList: s.itens.map((i, n) => ({
      CodigoEmpresaFilial: "", NumeroReqComp: "", Sequencia: n + 1,
      ItemServico: i.item_servico ? "Sim" : "Não", CodigoProduto: i.codigo_produto,
      CodigoAlternativoProduto: i.codigo_alternativo_produto || "", DataNecessidade: data,
      CodigoCentroCtrl: i.codigo_centro_ctrl || r.codigo_centro_ctrl,
      ...quantidadeUnidade(i),
      CodigoProdUnidMed: i.codigo_prod_unid_med, Observacao: i.observacao || "",
    })),
    ReqCompClasseRecDespChildList: s.rateio.map((c) => ({
      CodigoClasseRecDesp: c.codigo_classe_rec_desp, Percentual: Number(c.percentual),
      RateioReqCompChildList: c.ccs.map((cc) => ({
        CodigoClasseRecDesp: c.codigo_classe_rec_desp, CodigoCentroCtrl: cc.codigo_centro_ctrl, Percentual: Number(cc.percentual),
      })),
    })),
    MensagemRetorno: null, TextoHistoricoNovo: null, TipoFormulario: "Normal", UploadIdentify: "",
    ...(s.arquivos.length ? {
      ReqCompDocChildList: s.arquivos.map((a, n) => ({ CodigoEmpresaFilial: "-1", NumeroReqComp: "-1", Sequencia: n, UploadIdentify: a.upload_identify_guid })),
      filesToUpload: s.arquivos.map((a) => ({ key: `${a.upload_identify_guid}#Arquivo`, file: {} })),
    } : {}),
  };
}
