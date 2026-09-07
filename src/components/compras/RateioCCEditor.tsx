import type { RateioCCClasseInput } from "@/services/requisicoesService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function RateioCCEditor({ value, onChange, classes, centros }: {
  value: RateioCCClasseInput[];
  onChange: (value: RateioCCClasseInput[]) => void;
  classes: Array<{ codigo: string; nome: string }>;
  centros: Array<{ erp_code: string; name: string }>;
}) {
  const update = (index: number, patch: Partial<RateioCCClasseInput>) => onChange(value.map((v, i) => i === index ? { ...v, ...patch } : v));
  return <section className="space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">Distribuição por centro de custo (opcional)</h3>
    <p className="text-sm text-muted-foreground">Classes somam 100%. Dentro de cada classe, os centros de custo também somam 100%. O CC principal deve estar nesta distribuição.</p>
    {value.map((c, i) => <div key={i} className="space-y-2 border-t pt-3">
      <div className="flex gap-2 flex-wrap">
        <Select value={c.codigo_classe_rec_desp} onValueChange={codigo => update(i, { codigo_classe_rec_desp: codigo, classe_rec_desp_label: classes.find(x => x.codigo === codigo)?.nome })}>
          <SelectTrigger aria-label={`Classe da distribuição ${i + 1}`} className="min-w-0 flex-1 text-foreground"><SelectValue placeholder="Selecione a classe" /></SelectTrigger>
          <SelectContent>{classes.map(x => <SelectItem key={x.codigo} value={x.codigo}>{x.codigo} — {x.nome}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="w-28" type="number" min="0.0001" max="100" step="0.0001" aria-label={`Percentual da classe ${i + 1}`} value={c.percentual} onChange={(e) => update(i, { percentual: Number(e.target.value) })} />
        <Button type="button" variant="ghost" onClick={() => onChange(value.filter((_, j) => i !== j))}>Remover classe</Button>
      </div>
      {c.ccs.map((cc, j) => <div key={j} className="flex gap-2 flex-wrap">
        <Select value={cc.codigo_centro_ctrl} onValueChange={codigo => update(i, { ccs: c.ccs.map((x, k) => j === k ? { ...x, codigo_centro_ctrl: codigo, centro_ctrl_label: centros.find(v => v.erp_code === codigo)?.name } : x) })}>
          <SelectTrigger aria-label={`CC ${j + 1} da classe ${i + 1}`} className="min-w-0 flex-1 text-foreground"><SelectValue placeholder="Selecione o centro de custo" /></SelectTrigger>
          <SelectContent>{centros.map(x => <SelectItem key={x.erp_code} value={x.erp_code}>{x.erp_code} — {x.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="w-28" type="number" min="0.0001" max="100" step="0.0001" aria-label={`Percentual do CC ${j + 1} da classe ${i + 1}`} value={cc.percentual} onChange={(e) => update(i, { ccs: c.ccs.map((x, k) => j === k ? { ...x, percentual: Number(e.target.value) } : x) })} />
        <Button type="button" variant="ghost" onClick={() => update(i, { ccs: c.ccs.filter((_, k) => k !== j) })}>Remover CC</Button>
      </div>)}
      <Button type="button" variant="outline" onClick={() => update(i, { ccs: [...c.ccs, { codigo_centro_ctrl: "", percentual: 0 }] })}>Adicionar CC</Button>
    </div>)}
    <Button type="button" variant="outline" onClick={() => onChange([...value, { codigo_classe_rec_desp: "", percentual: value.length ? 0 : 100, ccs: [{ codigo_centro_ctrl: "", percentual: 100 }] }])}>Adicionar classe à distribuição</Button>
  </section>;
}
