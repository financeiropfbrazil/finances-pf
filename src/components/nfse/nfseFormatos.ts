// Formatos da tela Notas de Serviço (lista e detalhe em etapas).

export const formatCurrency = (v: number | string | null | undefined) =>
  v != null && v !== "" && !Number.isNaN(Number(v))
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v))
    : "—";

/** "YYYY-MM-DD" formatado por split, sem fuso (new Date() recuaria 1 dia em UTC-3). */
export const formatDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

/** Instante (timestamptz) sempre no horário de Brasília — o Hub também é usado na Áustria. */
export const formatInstanteBrt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const formatDoc = (doc: string | null | undefined) => {
  if (!doc) return "—";
  const c = doc.replace(/\D/g, "");
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  return doc;
};

export const formatBytes = (n: number | null | undefined) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB`;
  return `${(n / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

/** Hoje em "YYYY-MM-DD" no horário de Brasília (para comparar com datas de vencimento). */
export const hojeBrt = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
