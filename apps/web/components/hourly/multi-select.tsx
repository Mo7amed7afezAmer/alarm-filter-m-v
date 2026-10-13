"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  count?: number;
}

/** Dropdown with checkboxes; `searchable` adds a filter box (alarm names: dozens of values). */
export function MultiSelect({
  label,
  options,
  value,
  onChange,
  searchable,
  placeholder = "All",
  className,
  swatch,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
  placeholder?: string;
  className?: string;
  /** Optional color dot per option (office colors). */
  swatch?: (value: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const selected = useMemo(() => new Set(value.map((v) => v.toUpperCase())), [value]);
  // keep selected values visible even if the current data no longer has them
  const all = useMemo<Option[]>(() => {
    const known = new Set(options.map((o) => o.value.toUpperCase()));
    return [...options, ...value.filter((v) => !known.has(v.toUpperCase())).map((v) => ({ value: v }))];
  }, [options, value]);
  const shown = q ? all.filter((o) => o.value.toUpperCase().includes(q.trim().toUpperCase())) : all;

  const toggle = (v: string) =>
    onChange(
      selected.has(v.toUpperCase()) ? value.filter((x) => x.toUpperCase() !== v.toUpperCase()) : [...value, v],
    );

  const summary =
    value.length === 0 ? placeholder : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-white px-3 text-left text-sm shadow-sm",
          value.length ? "text-slate-900" : "text-slate-500",
        )}
      >
        <span className="truncate">{summary}</span>
        <span className="flex shrink-0 items-center gap-1">
          {value.length > 0 && (
            <X
              className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700"
              aria-label={`Clear ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            />
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </span>
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-[min(22rem,90vw)] rounded-md border border-slate-200 bg-white shadow-lg">
          {searchable && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                autoFocus
                className="w-full bg-transparent text-sm outline-none"
                placeholder={`Search ${label.toLowerCase()}…`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          <ul role="listbox" aria-multiselectable className="max-h-72 overflow-auto py-1">
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matches</li>}
            {shown.map((o) => {
              const on = selected.has(o.value.toUpperCase());
              const color = swatch?.(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    {color && (
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm border border-black/10"
                        style={{ background: `#${color}` }}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.value}</span>
                    {o.count != null && (
                      <span className="shrink-0 tabular-nums text-xs text-slate-400">{o.count}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
