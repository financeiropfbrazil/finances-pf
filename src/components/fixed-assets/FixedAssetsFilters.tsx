import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Search, X } from "lucide-react";
import type { AssetCategory } from "@/hooks/useFixedAssetsCategories";
import { cn } from "@/lib/utils";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  categories: AssetCategory[];
  fullyDepreciatedOnly: boolean;
  onFullyDepreciatedChange: (v: boolean) => void;
}

export default function FixedAssetsFilters({ 
  search, 
  onSearchChange, 
  category, 
  onCategoryChange, 
  categories = [], 
  fullyDepreciatedOnly, 
  onFullyDepreciatedChange 
}: Props) {
  return (
    <Card className="bg-muted/30 border-none shadow-none">
      <CardContent className="p-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 text-muted-foreground mr-2">
          <Search className="h-4 w-4" />
          <span className="text-sm font-medium">Filtros</span>
        </div>

        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
          <Input
            placeholder="Buscar por código ou descrição..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-8 bg-background border-muted-foreground/20 focus-visible:ring-primary/30"
          />
          {search && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hover:bg-transparent" 
              onClick={() => onSearchChange("")}
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-muted-foreground/20 bg-background cursor-pointer text-sm">
            <Checkbox
              checked={fullyDepreciatedOnly}
              onCheckedChange={(v) => onFullyDepreciatedChange(v === true)}
              className="h-4 w-4"
            />
            <span className="whitespace-nowrap">100% Depreciados</span>
          </label>

          <div className="flex flex-wrap gap-1.5 p-1 bg-background border border-muted-foreground/20 rounded-lg">
            <Badge
              variant={category === "all" ? "secondary" : "outline"}
              className={cn(
                "cursor-pointer text-xs h-7 px-3",
                category === "all" ? "bg-secondary shadow-sm" : "hover:bg-muted"
              )}
              onClick={() => onCategoryChange("all")}
            >
              Todas
            </Badge>
            {categories.map((c) => (
              <Badge
                key={c.code}
                variant={category === c.code ? "secondary" : "outline"}
                className={cn(
                  "cursor-pointer text-xs h-7 px-3",
                  category === c.code ? "bg-secondary shadow-sm" : "hover:bg-muted"
                )}
                onClick={() => onCategoryChange(c.code)}
              >
                {c.label}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
