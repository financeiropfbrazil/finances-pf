// Aplicação local e estrita no repo do gateway autorizado; sem deploy neste script.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
const path = '../erp-proxy/src/routes/produto.ts';
let source = readFileSync(path, 'utf8');
if (source.includes('carregarProdutoLeitura')) throw Error('Correção já aplicada; revisar diff.');
source = source.replace('const router = Router();', `import { randomUUID } from "node:crypto";
import { carregarProdutoLeitura, type EtapaProduto } from "./produto-leitura";

const router = Router();`);
const start = source.indexOf('router.get("/load"');
const at = source.indexOf('  const result = await callAlvo(endpoint, "GET");', start);
if (start < 0 || at < 0) throw Error('Handler esperado ausente');
source = source.slice(0, at) + `  // Fluxo Financial Hub: 48,59s de autenticação observados em produção já
  // excediam os antigos 45s do navegador. Orçamento total limitado, inclusive body.
  let result;
  if (req.user?.source === "financial_hub") {
    const requestId = randomUUID();
    const controller = new AbortController();
    const inicio = Date.now();
    let fase: EtapaProduto = "autenticacao";
    let inicioEtapa = inicio;
    let expirou = false;
    const cancelar = () => { if (!res.writableEnded) controller.abort(); };
    res.once("close", cancelar);
    const timer = setTimeout(() => { expirou = true; controller.abort(); }, 120_000);
    const registrar = (evento: string) => console.log(JSON.stringify({
      evento, requestId, codigo, etapa: fase, etapa_ms: Date.now() - inicioEtapa, total_ms: Date.now() - inicio,
    }));
    try {
      result = await carregarProdutoLeitura(codigo, controller.signal, proxima => {
        registrar("produto_leitura_etapa"); fase = proxima; inicioEtapa = Date.now();
      });
      registrar("produto_leitura_concluida");
    } catch {
      registrar(expirou ? "produto_leitura_timeout" : controller.signal.aborted ? "produto_leitura_cancelada" : "produto_leitura_falha");
      if (!res.destroyed) res.status(expirou ? 504 : 502).json({
        error: expirou
          ? "O Alvo não concluiu a consulta do produto em 120 segundos. Tente novamente."
          : "Falha de comunicação ao consultar o produto no Alvo. Tente novamente.",
        etapa: fase, requestId,
      });
      return;
    } finally {
      clearTimeout(timer); res.off("close", cancelar);
    }
  } else {
    result = await callAlvo(endpoint, "GET");
  }` + source.slice(at + '  const result = await callAlvo(endpoint, "GET");'.length);
writeFileSync(path, source);
copyFileSync('docs/aprovacao-multicc/gateway/produto-leitura.ts', '../erp-proxy/src/routes/produto-leitura.ts');
const index = '../erp-proxy/src/index.ts';
const current = readFileSync(index, 'utf8');
if (!current.includes('requisicoes: "multicc-20260907-aceite-1",')) throw Error('Health inesperado');
writeFileSync(index, current.replace('requisicoes: "multicc-20260907-aceite-1",', 'requisicoes: "multicc-20260907-aceite-1",\n    unidades: "multicc-aceite-3-leitura-120s",'));
