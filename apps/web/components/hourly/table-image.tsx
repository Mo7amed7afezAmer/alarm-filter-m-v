"use client";

// "Table as image" for sharing on WhatsApp: the filtered rows are drawn on a <canvas> (office
// colors, header, title) and split into pages so each picture stays readable on a phone.
// By default each category (DOWN / POWER / OTHER) gets its own images — never mixed.
// Share uses the Web Share API with files (phones, HTTPS only — e.g. via the tunnel); on the
// LAN (plain http) the images are downloaded and attached in WhatsApp Web / Desktop.

import {
  CATEGORIES,
  HOURLY_COLUMNS,
  hourlyCellText,
  officeColor,
  type HourlyColumnKey,
  type HourlyFilters,
  type HourlyRow,
} from "@alarm/core";
import { Copy, Download, ImageIcon, Loader2, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Short column set that fits a phone screen. */
export const COMPACT_COLUMNS: HourlyColumnKey[] = [
  "alarmTime",
  "alarmName",
  "siteName",
  "code",
  "office",
  "nodality",
  "vip",
  "battery",
  "phone",
  "siteType",
];

const FONT = `"Segoe UI", Roboto, Arial, sans-serif`;
const SIZE = 13;
const ROW_H = 24;
const PAD_X = 8;
const MAX_COL_W = 320;
const SCALE = 2;

/** "Office: TANTA, DUMIAT · Sheet: Environmental" — empty when nothing is filtered. */
export function filterSummary(f: HourlyFilters): string {
  const parts: string[] = [];
  if (f.sheet) parts.push(f.sheet.replace("_", " "));
  const list = (label: string, v?: string[]) => v?.length && parts.push(`${label}: ${v.join(", ")}`);
  list("Office", f.office);
  list("Alarm", f.alarm);
  list("Region", f.region);
  list("Site type", f.siteType);
  list("Category", f.category);
  if (f.vip !== undefined) parts.push(f.vip ? "VIP only" : "Non-VIP");
  if (f.from || f.to) parts.push(`Time: ${f.from?.replace("T", " ") ?? "…"} → ${f.to?.replace("T", " ") ?? "…"}`);
  if (f.q) parts.push(`Search: ${f.q}`);
  return parts.join(" · ");
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

/** One page of rows → PNG blob. Column widths are computed over ALL rows so pages line up. */
function renderPage(opts: {
  rows: HourlyRow[];
  cols: { key: HourlyColumnKey; header: string }[];
  widths: number[];
  title: string;
  subtitle: string;
  footer: string;
}): Promise<Blob> {
  const { rows, cols, widths, title, subtitle, footer } = opts;
  const tableW = widths.reduce((a, b) => a + b, 0);
  const W = Math.max(tableW + 2, 480);
  const titleH = subtitle ? 56 : 36;
  const H = titleH + ROW_H * (rows.length + 1) + 28;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  // title
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText(fit(ctx, title, W - 2 * PAD_X), PAD_X, 18);
  if (subtitle) {
    ctx.fillStyle = "#475569";
    ctx.font = `${SIZE - 1}px ${FONT}`;
    ctx.fillText(fit(ctx, subtitle, W - 2 * PAD_X), PAD_X, 40);
  }

  // header
  let y = titleH;
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(1, y, tableW, ROW_H);
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${SIZE}px ${FONT}`;
  let x = 1;
  cols.forEach((c, i) => {
    ctx.fillText(fit(ctx, c.header, widths[i]! - 2 * PAD_X), x + PAD_X, y + ROW_H / 2);
    x += widths[i]!;
  });

  // rows
  ctx.font = `${SIZE}px ${FONT}`;
  for (const r of rows) {
    y += ROW_H;
    const color = officeColor(r.office);
    ctx.fillStyle = color ? `#${color}` : "#ffffff";
    ctx.fillRect(1, y, tableW, ROW_H);
    ctx.fillStyle = "#0f172a";
    x = 1;
    cols.forEach((c, i) => {
      ctx.fillText(fit(ctx, hourlyCellText(r, c.key), widths[i]! - 2 * PAD_X), x + PAD_X, y + ROW_H / 2);
      x += widths[i]!;
    });
  }

  // grid
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 0.5;
  const top = titleH;
  const bottom = titleH + ROW_H * (rows.length + 1);
  for (let i = 0; i <= rows.length + 1; i++) {
    ctx.beginPath();
    ctx.moveTo(1, top + i * ROW_H);
    ctx.lineTo(1 + tableW, top + i * ROW_H);
    ctx.stroke();
  }
  x = 1;
  for (let i = 0; i <= widths.length; i++) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    x += widths[i] ?? 0;
  }

  ctx.fillStyle = "#64748b";
  ctx.font = `${SIZE - 2}px ${FONT}`;
  ctx.fillText(footer, PAD_X, bottom + 14);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Image could not be created"))), "image/png"),
  );
}

function columnWidths(rows: HourlyRow[], cols: { key: HourlyColumnKey; header: string }[]): number[] {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return cols.map((c) => {
    ctx.font = `bold ${SIZE}px ${FONT}`;
    let w = ctx.measureText(c.header).width;
    ctx.font = `${SIZE}px ${FONT}`;
    for (const r of rows) w = Math.max(w, ctx.measureText(hourlyCellText(r, c.key)).width);
    return Math.ceil(Math.min(w, MAX_COL_W) + 2 * PAD_X);
  });
}

interface Page {
  file: File;
  url: string;
}

export function TableImageButton({
  rows,
  visibleColumns,
  title,
  filters,
  fileStem,
}: {
  rows: HourlyRow[];
  visibleColumns: HourlyColumnKey[];
  title: string;
  filters: HourlyFilters;
  /** File name prefix, e.g. "hourly-2026-10-13_0700". */
  fileStem: string;
}) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(true);
  const [perPage, setPerPage] = useState(40);
  const [byCategory, setByCategory] = useState(true);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const keys = compact ? COMPACT_COLUMNS : visibleColumns;
  const cols = useMemo(() => HOURLY_COLUMNS.filter((c) => keys.includes(c.key)), [keys]);
  const subtitle = filterSummary(filters);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const made: Page[] = [];
    setBusy(true);
    setMsg(null);
    (async () => {
      // same column widths for every image so they line up when scrolled through
      const widths = columnWidths(rows, cols);
      const stamp = new Date().toLocaleString("en-GB", { hour12: false });
      const groups: { label: string | null; rows: HourlyRow[] }[] = byCategory
        ? CATEGORIES.map((c) => ({ label: c as string | null, rows: rows.filter((r) => r.category === c) })).filter(
            (g) => g.rows.length,
          )
        : [{ label: null, rows }];
      if (!groups.length) groups.push({ label: null, rows: [] });
      for (const g of groups) {
        const n = Math.max(1, Math.ceil(g.rows.length / perPage));
        const head = g.label ? `${title} · ${g.label}` : title;
        for (let i = 0; i < n && !cancelled; i++) {
          const slice = g.rows.slice(i * perPage, (i + 1) * perPage);
          const range = g.rows.length
            ? `${g.label ? `${g.label} ` : ""}rows ${i * perPage + 1}–${i * perPage + slice.length} of ${g.rows.length}`
            : "no rows";
          const blob = await renderPage({
            rows: slice,
            cols,
            widths,
            title: n > 1 ? `${head}  (${i + 1}/${n})` : head,
            subtitle,
            footer: `${range} · Alarm Filter · ${stamp}`,
          });
          const name = `${fileStem}${g.label ? `-${g.label.toLowerCase()}` : ""}${n > 1 ? `-${i + 1}of${n}` : ""}.png`;
          const file = new File([blob], name, { type: "image/png" });
          made.push({ file, url: URL.createObjectURL(blob) });
        }
      }
      if (!cancelled) setPages(made);
    })()
      .catch((e) => !cancelled && setMsg((e as Error).message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
      made.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [open, rows, cols, perPage, byCategory, title, subtitle, fileStem]);

  const files = pages.map((p) => p.file);
  const canShare =
    typeof navigator !== "undefined" && !!navigator.canShare && files.length > 0 && navigator.canShare({ files });
  const canCopy =
    typeof window !== "undefined" && window.isSecureContext && !!navigator.clipboard && "ClipboardItem" in window;

  const share = async () => {
    try {
      await navigator.share({ files, title });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg(`Share failed: ${(e as Error).message}`);
    }
  };
  const download = () => {
    pages.forEach((p, i) =>
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = p.url;
        a.download = p.file.name;
        a.click();
      }, i * 300),
    );
  };
  const copy = async (p: Page) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": p.file })]);
      setMsg("Image copied — paste it in WhatsApp (Ctrl+V)");
    } catch (e) {
      setMsg(`Copy failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="bg-white" onClick={() => setOpen(true)} data-testid="table-image">
        <ImageIcon className="h-4 w-4" />
        Image for WhatsApp
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6"
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div role="dialog" aria-label="Table as image" className="w-full max-w-5xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="font-semibold text-slate-900">Table as image</h2>
              <button aria-label="Close" className="text-slate-500 hover:text-slate-900" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Columns</span>
                <select
                  className="h-9 rounded-md border border-input bg-white px-2"
                  value={compact ? "compact" : "visible"}
                  onChange={(e) => setCompact(e.target.value === "compact")}
                >
                  <option value="compact">Compact (fits a phone)</option>
                  <option value="visible">Same as the table ({visibleColumns.length})</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">Rows per image</span>
                <select
                  className="h-9 rounded-md border border-input bg-white px-2"
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                >
                  {[25, 40, 60, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex h-9 items-center gap-2">
                <input type="checkbox" checked={byCategory} onChange={(e) => setByCategory(e.target.checked)} />
                Separate images per category (Down / Power / Other)
              </label>
              <div className="ml-auto flex flex-wrap gap-2">
                {canShare && (
                  <Button size="sm" onClick={() => void share()} disabled={busy}>
                    <Share2 className="h-4 w-4" />
                    Share{pages.length > 1 ? ` ${pages.length} images` : ""}
                  </Button>
                )}
                <Button size="sm" variant={canShare ? "outline" : "default"} onClick={download} disabled={busy || !pages.length}>
                  <Download className="h-4 w-4" />
                  Download{pages.length > 1 ? ` ${pages.length} images` : ""}
                </Button>
              </div>
            </div>
            <div className="space-y-1 px-4 pt-2 text-xs text-slate-500">
              {rows.length.toLocaleString("en-US")} rows → {pages.length} image{pages.length === 1 ? "" : "s"}
              {!canShare && (
                <span>
                  {" "}
                  · Direct sharing needs a phone on HTTPS — here, download (or copy) and attach in WhatsApp.
                </span>
              )}
              {msg && <div className="font-medium text-slate-800">{msg}</div>}
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-auto p-4">
              {busy && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" /> Drawing…
                </div>
              )}
              {!busy &&
                pages.map((p) => (
                  <figure key={p.url} className="space-y-1">
                    <figcaption className="flex items-center gap-2 text-xs text-slate-500">
                      {p.file.name}
                      {canCopy && (
                        <button
                          className={cn("inline-flex items-center gap-1 text-sky-700 hover:underline")}
                          onClick={() => void copy(p)}
                        >
                          <Copy className="h-3 w-3" /> Copy
                        </button>
                      )}
                    </figcaption>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.file.name} className="max-w-full rounded border border-slate-200" />
                  </figure>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
