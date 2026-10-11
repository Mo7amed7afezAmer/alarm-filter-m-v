import { Badge } from "@/components/ui/badge";
import { CATEGORY_STYLES } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CategoryBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", CATEGORY_STYLES[value])}>
      {value}
    </Badge>
  );
}

export function ClearTypeBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return value === "EMAIL" ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
      Clear email
    </Badge>
  ) : (
    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-800">
      Superseded
    </Badge>
  );
}
