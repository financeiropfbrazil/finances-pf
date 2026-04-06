import { supabase } from "@/integrations/supabase/client";

export async function downloadStorageFile(storagePath: string, filename?: string) {
  const { data, error } = await supabase.storage
    .from("email-nfe-attachments")
    .download(storagePath);

  if (error || !data) {
    console.error("Download error:", error);
    return;
  }

  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || storagePath.split("/").pop() || "download";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
