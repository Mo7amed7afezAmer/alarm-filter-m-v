"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface AppConfig {
  timeZone: string;
  alertHours: number;
  role: "VIEWER" | "ADMIN";
  email: string;
  /** Selected office (Gmail label), e.g. "DN/Kafr ElDawar". */
  office: string | null;
  /** Number of alarm types (categories + names) hidden in /settings. */
  hiddenTypes: number;
  /** Number of alarm types this user hides from their own pages (/preferences). */
  myHiddenTypes: number;
}

const Ctx = createContext<AppConfig | null>(null);

export function AppConfigProvider({ value, children }: { value: AppConfig; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppConfig(): AppConfig {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppConfig outside AppConfigProvider");
  return v;
}
