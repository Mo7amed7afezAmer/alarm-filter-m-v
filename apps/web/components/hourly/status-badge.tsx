import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import type { ReportItem } from "./client";

/** not processed / processing (spinner) / done (row count) / failed (error in tooltip). */
export function ReportStatusBadge({ item }: { item: Pick<ReportItem, "status" | "meta" | "error"> }) {
  switch (item.status) {
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…
        </span>
      );
    case "done":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {item.meta?.rowCount.toLocaleString("en-US")} rows
        </span>
      );
    case "failed":
      return (
        <span
          title={item.error}
          className="inline-flex max-w-[16rem] cursor-help items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800"
        >
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Failed: {item.error}</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
          <CircleDashed className="h-3.5 w-3.5" /> Not processed
        </span>
      );
  }
}
