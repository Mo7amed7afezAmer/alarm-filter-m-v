import { Clock, MapPin, RadioTower } from "lucide-react";
import type { ReactNode } from "react";
import { CATEGORY_STRIPE, splitAlarmName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "./badges";

/** Alarm name without the vendor prefix (shown as a small tag); full name on hover. */
export function AlarmName({ value, className }: { value: string; className?: string }) {
  const { prefix, name } = splitAlarmName(value);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={value}>
      <span className="truncate font-medium text-slate-900">{name}</span>
      {prefix && (
        <span className="shrink-0 rounded bg-slate-100 px-1 py-px font-mono text-[10px] text-slate-500">
          {prefix}
        </span>
      )}
    </span>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-slate-600", className)}>{children}</span>;
}

/** Phone card for an alarm row. */
export function AlarmCard({
  alarmName,
  category,
  site,
  cell,
  meta,
  right,
  alert,
}: {
  alarmName: string;
  category: string;
  site: string;
  cell?: string | null;
  meta: ReactNode;
  right?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-l-4 border-slate-200 bg-white p-3 shadow-sm",
        CATEGORY_STRIPE[category],
        alert && "bg-red-50/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <AlarmName value={alarmName} className="flex-wrap" />
        <CategoryBadge value={category} />
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <Mono className="break-all">{site}</Mono>
        </div>
        {cell && (
          <div className="flex items-center gap-1.5">
            <RadioTower className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <Mono className="break-all">{cell}</Mono>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {meta}
          </span>
          {right}
        </div>
      </div>
    </div>
  );
}
