"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Filters live in the URL so a view can be shared/bookmarked. */
export function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page"); // any filter change → back to page 1
    const qs = next.toString();
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  return { params, set };
}

export function CategoryFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <Field label="Category">
      <Select value={value || "ALL"} onValueChange={(v) => onChange(v === "ALL" ? null : v)}>
        <SelectTrigger className="w-full bg-white sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All</SelectItem>
          <SelectItem value="DOWN">Down</SelectItem>
          <SelectItem value="POWER">Power</SelectItem>
          <SelectItem value="OTHER">Other</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Text input that updates the URL 400ms after typing stops. */
export function TextFilter({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string | null) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const id = setTimeout(() => onChange(text.trim() || null), 400);
    return () => clearTimeout(id);
  }, [text, value, onChange]);
  return (
    <Field label={label}>
      <Input
        className="w-full bg-white sm:w-56"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
    </Field>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <Label className="text-xs font-medium text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

/** Always visible from `sm` up; on phones collapsed behind a "Filters" toggle so the list is
 *  visible first. `active` = number of filters currently set (shown on the toggle). */
export function FilterBar({ children, active = 0 }: { children: ReactNode; active?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-slate-700 sm:hidden"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-slate-500" />
          Filters
          {active > 0 && (
            <span className="rounded-full bg-slate-900 px-1.5 text-[11px] font-semibold text-white">
              {active}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")}
        />
      </button>
      <div
        className={cn(
          "grid-cols-1 gap-3 border-t border-slate-100 p-3 sm:flex sm:flex-wrap sm:items-end sm:border-0",
          open ? "grid" : "hidden",
        )}
      >
        {children}
      </div>
    </div>
  );
}
