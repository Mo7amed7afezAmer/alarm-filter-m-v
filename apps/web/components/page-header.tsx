import type { ReactNode } from "react";

/** Title + optional count/subtitle on the left, actions on the right; stacks on phones. */
export function PageHeader({
  title,
  count,
  subtitle,
  actions,
}: {
  title: string;
  count?: number | null;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-baseline gap-2 text-2xl font-semibold tracking-tight text-slate-900">
          {title}
          {count != null && (
            <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-sm font-medium tabular-nums text-slate-600">
              {count.toLocaleString("en-US")}
            </span>
          )}
        </h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
