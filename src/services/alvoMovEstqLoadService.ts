import { authenticateAlvo, clearAlvoToken } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";

/**
 * Carrega um MovEstq existente do Alvo (GET MovEstq/Load).
 * Browser-side, mesmo padrão do alvoPedCompLoadService.
 *
 * @param chave  Chave do MovEstq (ex: 14367)
 * @param codigoEmpresaFilial  default "1.01"
 * @returns o JSON completo do lançamento, ou lança erro
 */
export async function carregarMovEstq(chave: number | string, codigoEmpresaFilial = "1.01"): Promise<any> {
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error("Falha na autenticação ERP");
  }

  const url = `${ERP_BASE_URL}/MovEstq/Load?codigoEmpresaFilial=${encodeURIComponent(
    codigoEmpresaFilial,
  )}&chave=${encodeURIComponent(String(chave))}&loadChild=All`;

  const resp = await fetch(url, {
    method: "GET",
    headers: { "riosoft-token": auth.token },
  });

  if (resp.status === 409) {
    clearAlvoToken();
    throw new Error("Conflito de sessão (409) — tente novamente");
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    let msg = `HTTP ${resp.status}`;
    try {
      msg = JSON.parse(t).Message || msg;
    } catch {}
    throw new Error(msg);
  }

  return resp.json();
}
