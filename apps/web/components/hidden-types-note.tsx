"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyeOff } from "lucide-react";
import { useAppConfig } from "./app-config";

const PAGES = ["/alarms", "/cleared", "/dashboard"];

const plural = (n: number) => `${n} alarm type${n > 1 ? "s" : ""}`;

/** Tells the user that some alarm types are hidden (by the admin and/or by themselves). */
export function HiddenTypesNote() {
  const path = usePathname();
  const { hiddenTypes, myHiddenTypes, role } = useAppConfig();
  if ((!hiddenTypes && !myHiddenTypes) || !PAGES.some((p) => path.startsWith(p))) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <EyeOff className="h-3.5 w-3.5 shrink-0" />
      {hiddenTypes > 0 && (
        <span>
          {plural(hiddenTypes)} hidden for everyone
          {role === "SUPER_ADMIN" && (
            <>
              {" · "}
              <Link href="/settings#display" className="font-medium underline">
                Settings
              </Link>
            </>
          )}
        </span>
      )}
      {myHiddenTypes > 0 && (
        <span>
          {plural(myHiddenTypes)} hidden by you ·{" "}
          <Link href="/preferences#display" className="font-medium underline">
            My preferences
          </Link>
        </span>
      )}
    </div>
  );
}
