"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyeOff } from "lucide-react";
import { useAppConfig } from "./app-config";

const PAGES = ["/alarms", "/cleared", "/dashboard"];

/** Tells everyone that some alarm types are hidden, so nobody thinks alarms are missing. */
export function HiddenTypesNote() {
  const path = usePathname();
  const { hiddenTypes, role } = useAppConfig();
  if (!hiddenTypes || !PAGES.some((p) => path.startsWith(p))) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <EyeOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        {hiddenTypes} alarm type{hiddenTypes > 1 ? "s are" : " is"} hidden from display.{" "}
        {role === "ADMIN" ? (
          <Link href="/settings#display" className="font-medium underline">
            Change in Settings
          </Link>
        ) : (
          "Ask an admin to change this."
        )}
      </span>
    </div>
  );
}
