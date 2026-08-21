import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Teclado numérico na própria tela (FS3-4).
 *
 * O §A.1 do FS3-TELAS proíbe o teclado do sistema no caminho normal: de luva,
 * o teclado virtual do Android cobre metade da tela e tem teclas de 30px. Este
 * fica na página, com teclas de 64px.
 *
 * O valor é mantido como TEXTO, não como número, e por um motivo específico:
 * "1," e "1" viram o mesmo `1` se convertidos cedo, e o operador que digitou a
 * vírgula veria o caractere sumir debaixo do dedo. A conversão para número
 * acontece só na hora de enviar, em `valorNumerico`.
 *
 * Separador decimal é a VÍRGULA — é o que está impresso na balança da sala e o
 * que o operador brasileiro digita.
 */
export interface TecladoNumericoProps {
  valor: string;
  onChange: (valor: string) => void;
  /** Casas decimais aceitas. 0 = só inteiro (peça não se conta pela metade). */
  casasDecimais?: number;
}

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function TecladoNumerico({ valor, onChange, casasDecimais = 3 }: TecladoNumericoProps) {
  const digitar = (tecla: string) => {
    // Zero à esquerda não se acumula: "0" + "5" é 5, não 05.
    if (valor === "0" && tecla !== ",") {
      onChange(tecla);
      return;
    }
    const decimais = valor.split(",")[1];
    if (decimais !== undefined && decimais.length >= casasDecimais) return;
    onChange(valor + tecla);
  };

  const digitarVirgula = () => {
    if (casasDecimais === 0) return;
    if (valor.includes(",")) return;
    onChange(valor === "" ? "0," : valor + ",");
  };

  const apagar = () => onChange(valor.slice(0, -1));

  const classeTecla =
    "flex h-16 items-center justify-center rounded-lg border border-border bg-card text-2xl font-medium tabular-nums text-foreground transition-colors active:bg-accent";

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Teclado numérico">
      {TECLAS.map((tecla) => (
        <button key={tecla} type="button" onClick={() => digitar(tecla)} className={classeTecla}>
          {tecla}
        </button>
      ))}
      <button
        type="button"
        onClick={digitarVirgula}
        disabled={casasDecimais === 0}
        className={cn(classeTecla, "disabled:opacity-30")}
        aria-label="Vírgula decimal"
      >
        ,
      </button>
      <button type="button" onClick={() => digitar("0")} className={classeTecla}>
        0
      </button>
      <button type="button" onClick={apagar} className={classeTecla} aria-label="Apagar último dígito">
        <Delete className="h-6 w-6" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Texto do teclado → número. Retorna null quando não há valor utilizável, e
 * quem chama trata: não existe "quantidade 0" válida no módulo (as RPCs
 * recusam `quantidade <= 0`).
 */
export function valorNumerico(valor: string): number | null {
  if (!valor || valor === "," || valor === "0," || valor === "0") return null;
  const numero = Number(valor.replace(",", "."));
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return numero;
}
