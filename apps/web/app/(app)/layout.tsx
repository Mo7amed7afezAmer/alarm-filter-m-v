import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppConfigProvider } from "@/components/app-config";
import { HiddenTypesNote } from "@/components/hidden-types-note";
import { Nav } from "@/components/nav";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scopeOfficeOf } from "@/lib/roles";
import { getDisplayFilter, getUserDisplayFilter, hiddenCount } from "@/lib/visibility";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  // Role + office from the database: a change by an admin applies on the next page load.
  const user = await prisma.user.findUnique({
    where: { id: Number(session.user.id) || -1 },
    select: { role: true, office: true },
  });
  if (!user) redirect("/login");
  const config = {
    timeZone: process.env.ALARM_TZ || "Africa/Cairo",
    alertHours: Number(process.env.ALERT_HOURS) || 4,
    role: user.role,
    email: session.user.email ?? "",
    office: scopeOfficeOf(user),
    /** The user's assigned office (super admin: the office they are viewing). */
    homeOffice: user.office,
    hiddenTypes: hiddenCount(await getDisplayFilter()),
    myHiddenTypes: hiddenCount(await getUserDisplayFilter(Number(session.user.id))),
  };
  return (
    <AppConfigProvider value={config}>
      <Nav />
      <main className="mx-auto max-w-screen-2xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        <HiddenTypesNote />
        {children}
      </main>
    </AppConfigProvider>
  );
}
