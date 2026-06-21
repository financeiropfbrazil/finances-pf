import { supabase } from "@/integrations/supabase/client";

/**
 * Baixa um PDF de reembolso intercompany do Supabase Storage (buckets privados).
 * A policy de SELECT para 'authenticated' permite o download pelo usuário logado.
 *
 * @param bucket - "intercompany-reembolso-manual" ou "intercompany-reembolso-nf"
 * @param storagePath - caminho retornado em pdf_status.storage_path
 * @param filename - nome sugerido para o arquivo baixado
 * @returns true se baixou; false se falhou (o caller mostra o aviso)
 */
export async function downloadIntercompanyPdf(
  bucket: string,
  storagePath: string,
  filename?: string,
): Promise<boolean> {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) {
    console.error("[downloadIntercompanyPdf] erro:", error);
    return false;
  }
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || storagePath.split("/").pop() || "invoice.pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
