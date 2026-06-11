// src/components/compras/UploadXmlButton.tsx
//
// Botão de upload manual de XML de NF-e. Lê um ou vários arquivos .xml,
// parseia no front (parseNfeXml), faz dedup por chave_acesso e insere em
// compras_nfe com origem='Upload'. Usa a sessão do usuário logado (sem api-key).

import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { parseNfeXml } from "@/services/parseNfeXml";

interface Props {
  onImported: () => void; // chamado após importar (para refazer o fetch da lista)
}

export function UploadXmlButton({ onImported }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setProcessing(true);

    let importadas = 0;
    let duplicadas = 0;
    let erros = 0;
    const erroDetalhes: string[] = [];

    const user = (await supabase.auth.getUser()).data.user;

    for (const file of Array.from(files)) {
      try {
        const xml = await file.text();
        const parsed = parseNfeXml(xml);

        // dedup por chave_acesso
        const { data: existing } = await supabase
          .from("compras_nfe")
          .select("id")
          .eq("chave_acesso", parsed.chave_acesso)
          .maybeSingle();

        if (existing) {
          duplicadas++;
          continue;
        }

        const { itens, ...campos } = parsed;
        const { error } = await supabase.from("compras_nfe").insert({
          ...campos,
          tipo_documento: "NFe",
          origem: "Upload",
          raw_xml: xml,
          dados_extraidos: { itens },
          created_by: user?.id ?? null,
        } as any);

        if (error) {
          // 23505 = corrida na constraint unique → conta como duplicada
          if ((error as any).code === "23505") {
            duplicadas++;
          } else {
            erros++;
            erroDetalhes.push(`${file.name}: ${error.message}`);
          }
        } else {
          importadas++;
        }
      } catch (e: any) {
        erros++;
        erroDetalhes.push(`${file.name}: ${e?.message || "erro ao processar"}`);
      }
    }

    // resumo
    const partes: string[] = [];
    if (importadas) partes.push(`${importadas} importada${importadas > 1 ? "s" : ""}`);
    if (duplicadas) partes.push(`${duplicadas} já existia${duplicadas > 1 ? "m" : ""}`);
    if (erros) partes.push(`${erros} com erro`);

    toast({
      title: "Upload de XML concluído",
      description: partes.join(" · ") || "Nenhum arquivo processado",
      variant: erros > 0 ? "destructive" : undefined,
    });

    if (erroDetalhes.length > 0) {
      console.warn("[UploadXml] erros:", erroDetalhes);
    }

    setProcessing(false);
    if (inputRef.current) inputRef.current.value = ""; // permite re-subir o mesmo arquivo
    if (importadas > 0) onImported();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={processing}
        onClick={() => inputRef.current?.click()}
      >
        {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Upload XML
      </Button>
    </>
  );
}
