import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppConfigProvider } from "@/components/app-config";
import { Nav } from "@/components/nav";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const config = {
    timeZone: process.env.ALARM_TZ || "Africa/Cairo",
    alertHours: Number(process.env.ALERT_HOURS) || 4,
    role: session.user.role,
    email: session.user.email ?? "",
  };
  return (
    <AppConfigProvider value={config}>
      <Nav />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {children}
      </main>
    </AppConfigProvider>
  );
}
