import { getAlvoToken, invalidateAlvoToken } from "../alvo-auth";

export type EtapaProduto = "autenticacao" | "consulta" | "resposta";

// Cancela apenas este leitor. A autenticação compartilhada continua disponível
// para os demais clientes e pode preencher seu cache normalmente.
function aguardar<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error("Consulta cancelada"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// Somente Produto/Load GET: não altera o cliente genérico nem retries de escrita.
export async function carregarProdutoLeitura(
  codigo: string, signal: AbortSignal, etapa: (value: EtapaProduto) => void,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const base = process.env.ALVO_BASE_URL;
  if (!base) throw new Error("ALVO_BASE_URL não configurado");
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    signal.throwIfAborted();
    etapa("autenticacao");
    const token = await aguardar(getAlvoToken(tentativa > 0), signal);
    signal.throwIfAborted();
    etapa("consulta");
    const response = await fetch(`${base.replace(/\/$/, "")}/Produto/Load?codigo=${encodeURIComponent(codigo)}&loadChild=All`, {
      method: "GET", signal,
      headers: { "Content-Type": "application/json", "riosoft-token": token },
    });
    etapa("resposta");
    const text = await response.text();
    signal.throwIfAborted();
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (tentativa === 0 && [401, 403, 409].includes(response.status)) {
      invalidateAlvoToken();
      continue;
    }
    return { ok: response.ok, status: response.status, data, error: response.ok ? undefined : `HTTP ${response.status}` };
  }
  throw new Error("Não foi possível consultar o produto");
}
