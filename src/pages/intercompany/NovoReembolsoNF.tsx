import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function NovoReembolsoNF() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Novo Reembolso NF</h1>
        <p className="text-muted-foreground">
          Selecione NFs do MovEstq Alvo e converta em INV de reembolso intercompany.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5" />
            Em construção
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Esta tela está sendo construída. Em breve estará disponível o fluxo completo de seleção de NFs do MovEstq,
            cesta de rascunho e emissão de Invoice intercompany para PEF Áustria.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
