import { useState, useCallback, forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  currency?: "BRL" | "USD" | "EUR";
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

/**
 * Currency input that formats values as BRL (or other currencies) automatically.
 * Stores raw number internally, displays formatted string on blur.
 */
const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  ({ value, onChange, currency = "BRL", disabled, className, placeholder }, ref) => {
    const [focused, setFocused] = useState(false);
    const [displayValue, setDisplayValue] = useState("");

    const formatValue = useCallback(
      (v: number) => {
        if (v === 0 && !focused) return "";
        return v.toLocaleString("pt-BR", {
          style: "currency",
          currency,
          minimumFractionDigits: 2,
        });
      },
      [currency, focused]
    );

    const handleFocus = () => {
      setFocused(true);
      setDisplayValue(value === 0 ? "" : value.toFixed(2).replace(".", ","));
    };

    const handleBlur = () => {
      setFocused(false);
      const cleaned = displayValue
        .replace(/[^\d,.-]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const parsed = parseFloat(cleaned);
      const final = isNaN(parsed) ? 0 : parsed;
      onChange(final);
      setDisplayValue("");
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setDisplayValue(e.target.value);
    };

    const shown = focused ? displayValue : value !== 0 ? formatValue(value) : "";

    return (
      <Input
        ref={ref}
        type={focused ? "text" : "text"}
        inputMode="decimal"
        value={shown}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        disabled={disabled}
        placeholder={placeholder ?? "R$ 0,00"}
        className={cn("text-right", className)}
      />
    );
  }
);

CurrencyInput.displayName = "CurrencyInput";

export { CurrencyInput };
