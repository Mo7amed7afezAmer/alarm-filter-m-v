import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/api";
import { notificationFeed } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** The signed-in user's notification feed (polled by the header bell). */
export const GET = handler(async () => {
  const session = await requireUser();
  return NextResponse.json(await notificationFeed(Number(session.user.id)));
});
