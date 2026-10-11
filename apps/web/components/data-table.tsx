"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  rowClassName?: (row: T) => string | undefined;
  /** Phone layout: one card per row (shown below the md breakpoint instead of the table). */
  renderCard?: (row: T) => ReactNode;
  getRowId?: (row: T) => string;
  empty?: string;
  loading?: boolean;
}

/** Sortable table (client-side sort of the current page) with a card list on phones. */
export function DataTable<T>({
  columns,
  data,
  rowClassName,
  renderCard,
  getRowId,
  empty = "No rows",
  loading,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });
  const rows = table.getRowModel().rows;

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-14 text-sm text-slate-500">
        {loading ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        ) : (
          <Inbox className="h-6 w-6 text-slate-400" />
        )}
        {loading ? "Loading…" : empty}
      </div>
    );
  }

  return (
    <>
      {renderCard && (
        <div className="space-y-2 md:hidden">
          {rows.map((r) => (
            <div key={r.id}>{renderCard(r.original)}</div>
          ))}
        </div>
      )}

      <div
        className={cn(
          "overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm",
          renderCard && "hidden md:block",
        )}
      >
        <Table>
          <TableHeader className="bg-slate-50/80">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const sortable = h.column.getCanSort();
                  return (
                    <TableHead
                      key={h.id}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        "h-10 whitespace-nowrap px-3 text-xs font-medium uppercase tracking-wide text-slate-500",
                        sortable && "cursor-pointer select-none hover:text-slate-900",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
                        {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn("border-l-4 border-l-transparent", rowClassName?.(row.original))}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-nowrap px-3 py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-2 text-sm text-slate-500 sm:flex-row">
      <span>{total.toLocaleString("en-US")} rows</span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <span className="px-2 tabular-nums">
            {page} / {pages}
          </span>
          <button
            className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
