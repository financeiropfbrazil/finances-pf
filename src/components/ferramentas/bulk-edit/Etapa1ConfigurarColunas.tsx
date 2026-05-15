import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BULK_EDIT_PRODUTO_FIELDS, type BulkEditFieldDefinition } from "@/constants/bulkEditFields";

interface Etapa1ConfigurarColunasProps {
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
}

export function Etapa1ConfigurarColunas({ selectedKeys, onChange }: Etapa1ConfigurarColunasProps) {
  const fields = useMemo<BulkEditFieldDefinition[]>(() => BULK_EDIT_PRODUTO_FIELDS, []);

  const toggle = (key: string, checked: boolean) => {
    if (checked) {
      if (!selectedKeys.includes(key)) onChange([...selectedKeys, key]);
    } else {
      onChange(selectedKeys.filter((k) => k !== key));
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Etapa 1 — Configurar Colunas</h2>
        <p className="text-sm text-muted-foreground">
          Selecione os campos que deseja editar em massa. Apenas estes campos aparecerão na planilha modelo.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => {
          const checked = selectedKeys.includes(field.key);
          return (
            <Card
              key={field.key}
              className={checked ? "border-primary/50 bg-primary/5" : undefined}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`field-${field.key}`}
                    checked={checked}
                    onCheckedChange={(value) => toggle(field.key, value === true)}
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-1">
                    <Label
                      htmlFor={`field-${field.key}`}
                      className="cursor-pointer text-sm font-medium text-foreground"
                    >
                      {field.label}
                    </Label>
                    <CardDescription className="text-xs">
                      <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{field.key}</code>
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {field.type === "enum" ? "Lista" : "Texto"}
                      </Badge>
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              {field.helpText && (
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">{field.helpText}</p>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <div className="rounded-md border border-border bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
        {selectedKeys.length === 0
          ? "Nenhum campo selecionado."
          : `${selectedKeys.length} ${selectedKeys.length === 1 ? "campo selecionado" : "campos selecionados"}.`}
      </div>
    </div>
  );
}

export default Etapa1ConfigurarColunas;
