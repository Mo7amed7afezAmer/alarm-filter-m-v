"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  BellRing,
  Building2,
  CircleCheck,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  RadioTower,
  Settings,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppConfig } from "./app-config";
import { NotificationBell } from "./notification-bell";

const LINKS: { href: string; label: string; icon: LucideIcon; admin?: boolean }[] = [
  { href: "/alarms", label: "Alarms", icon: BellRing },
  { href: "/cleared", label: "Cleared", icon: CircleCheck },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/hourly", label: "Hourly Alarms", icon: FileClock },
  { href: "/settings", label: "Settings", icon: Settings, admin: true },
];

/** "DN/Kafr ElDawar" → group "DN" + name "Kafr ElDawar". */
function OfficePill({ office }: { office: string }) {
  const i = office.lastIndexOf("/");
  const group = i > 0 ? office.slice(0, i) : null;
  const name = i > 0 ? office.slice(i + 1) : office;
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800"
      title={`Office: ${office}`}
    >
      <Building2 className="h-3.5 w-3.5 shrink-0" />
      {group && <span className="text-sky-600">{group}</span>}
      <span className="truncate">{name}</span>
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const { role, email, office } = useAppConfig();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]); // close the mobile menu after navigating

  const links = LINKS.filter((l) => !l.admin || role === "ADMIN");
  const isActive = (href: string) => path.startsWith(href);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4">
        <Link
          href="/alarms"
          className="flex shrink-0 items-center gap-2 font-semibold text-slate-900"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            <RadioTower className="h-4 w-4" />
          </span>
          <span className="hidden sm:inline">Alarm Filter</span>
        </Link>
        {office && <OfficePill office={office} />}

        <nav className="hidden items-center gap-1 md:flex">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                isActive(href) && "bg-slate-100 font-medium text-slate-900",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell />
          <Link
            href="/preferences"
            title="My preferences"
            aria-label="My preferences"
            className={cn(
              "hidden rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:block",
              isActive("/preferences") && "bg-slate-100 text-slate-900",
            )}
          >
            <UserCog className="h-5 w-5" />
          </Link>
          <div className="hidden items-center gap-3 md:flex">
            <div className="text-right leading-tight">
              <div className="max-w-[16rem] truncate text-sm text-slate-700">{email}</div>
              <div className="text-xs capitalize text-slate-500">{role.toLowerCase()}</div>
            </div>
            <button
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>

          <button
            className="rounded-md p-2 text-slate-700 hover:bg-slate-100 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-slate-200 bg-white md:hidden">
          <nav className="mx-auto flex max-w-screen-2xl flex-col gap-1 p-2">
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-slate-700 hover:bg-slate-100",
                  isActive(href) && "bg-slate-100 font-medium text-slate-900",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
            <Link
              href="/preferences"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-slate-700 hover:bg-slate-100",
                isActive("/preferences") && "bg-slate-100 font-medium text-slate-900",
              )}
            >
              <UserCog className="h-4 w-4" />
              My preferences
            </Link>
            <div className="mt-1 flex items-center justify-between border-t border-slate-100 px-3 pt-3 text-sm">
              <span className="truncate text-slate-500">
                {email} · {role.toLowerCase()}
              </span>
              <button
                className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-slate-600"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
