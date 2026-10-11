"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useAppConfig } from "./app-config";

const LINKS = [
  { href: "/alarms", label: "Alarms" },
  { href: "/cleared", label: "Cleared" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/settings", label: "Settings", admin: true },
];

export function Nav() {
  const path = usePathname();
  const { role, email } = useAppConfig();
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-6 px-4 py-2">
        <span className="font-semibold">Alarm Filter</span>
        <nav className="flex gap-1 text-sm">
          {LINKS.filter((l) => !l.admin || role === "ADMIN").map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-1.5 hover:bg-muted",
                path.startsWith(l.href) && "bg-muted font-medium",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {email} · {role.toLowerCase()}
          </span>
          <button
            className="rounded-md border px-2 py-1 hover:bg-muted"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
