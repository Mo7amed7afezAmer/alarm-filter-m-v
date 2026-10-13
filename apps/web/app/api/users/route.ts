import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const select = { id: true, email: true, role: true } as const;
const role = z.enum(["VIEWER", "OPERATOR", "ADMIN"]);
const password = z.string().min(8, "at least 8 characters").max(200);

export const GET = handler(async () => {
  await requireUser("ADMIN");
  return NextResponse.json({
    users: await prisma.user.findMany({ select, orderBy: { email: "asc" } }),
  });
});

export const POST = handler(async (req: Request) => {
  await requireUser("ADMIN");
  const body = await parseBody(
    req,
    z.object({
      email: z.string().trim().toLowerCase().email(),
      password,
      role: role.default("VIEWER"),
    }),
  );
  if (await prisma.user.findUnique({ where: { email: body.email } })) {
    throw new HttpError(409, "A user with this email already exists");
  }
  const user = await prisma.user.create({
    data: {
      email: body.email,
      role: body.role,
      passwordHash: await bcrypt.hash(body.password, 12),
    },
    select,
  });
  return NextResponse.json({ user }, { status: 201 });
});

/** Change role and/or reset password. Admins cannot demote themselves (avoids lock-out). */
export const PATCH = handler(async (req: Request) => {
  const session = await requireUser("ADMIN");
  const body = await parseBody(
    req,
    z.object({ id: z.number().int(), role: role.optional(), password: password.optional() }),
  );
  if (String(body.id) === session.user.id && body.role === "VIEWER") {
    throw new HttpError(400, "You cannot remove your own admin role");
  }
  const user = await prisma.user.update({
    where: { id: body.id },
    data: {
      ...(body.role ? { role: body.role } : {}),
      ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12) } : {}),
    },
    select,
  });
  return NextResponse.json({ user });
});

export const DELETE = handler(async (req: Request) => {
  const session = await requireUser("ADMIN");
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) throw new HttpError(400, "id required");
  if (String(id) === session.user.id) throw new HttpError(400, "You cannot delete yourself");
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ deleted: id });
});
