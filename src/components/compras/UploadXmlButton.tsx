// src/components/compras/UploadXmlButton.tsx
//
// Botão de upload manual de XML de NF-e. Lê um ou vários arquivos .xml,
// parseia no front (parseNfeXml) e grava pela RPC compras_nfe_importar_xml
// (origem='Upload', dedup por chave_acesso, gate compras.nfe.create — PLANO-NFE NFE-1).

import { useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { parseNfeXml } from "@/services/parseNfeXml";
import { importarXmlNfe } from "@/services/nfeRecebidasService";

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

    for (const file of Array.from(files)) {
      try {
        const xml = await file.text();
        const r = await importarXmlNfe(parseNfeXml(xml), xml);
        if (r.status === "importada") importadas++;
        else if (r.status === "duplicada") duplicadas++;
        else {
          erros++;
          erroDetalhes.push(`${file.name}: ${r.mensagem ?? "erro ao importar"}`);
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
