// User management. Super admin: every account, any role, any office. Office admin: the viewers /
// operators of their own office only (lib/roles.ts). Nobody edits or deletes themselves here.
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handler, HttpError, parseBody, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { availableOffices } from "@/lib/office";
import { canManage, checkAssignment, isSuperAdmin, ROLES, type Account } from "@/lib/roles";

export const dynamic = "force-dynamic";

const select = { id: true, email: true, role: true, office: true } as const;
const role = z.enum(ROLES);
const password = z.string().min(8, "at least 8 characters").max(200);
const office = z.string().trim().max(200).nullable().optional();

async function actorOf(): Promise<Account> {
  const session = await requireUser("ADMIN");
  return {
    id: Number(session.user.id),
    role: session.user.role,
    office: session.user.office ?? null,
  };
}

async function target(actor: Account, id: number): Promise<Account> {
  const user = await prisma.user.findUnique({ where: { id }, select });
  // 404 (not 403) for accounts outside the admin's office: they do not exist for them.
  if (!user || (!canManage(actor, user) && actor.id !== id)) throw new HttpError(404, "User not found");
  if (actor.id === id) throw new HttpError(400, "You cannot change your own account here");
  return user;
}

async function checkOffice(value: string | null) {
  if (!value) return;
  const offices = await availableOffices();
  if (offices.length && !offices.includes(value))
    throw new HttpError(400, `Unknown office "${value}"`);
}

/** Accounts the actor manages (plus themselves, read-only), and what they may assign. */
export const GET = handler(async () => {
  const actor = await actorOf();
  const users = await prisma.user.findMany({
    where: isSuperAdmin(actor.role) ? {} : { office: actor.office ?? "" },
    select,
    orderBy: [{ office: "asc" }, { email: "asc" }],
  });
  return NextResponse.json({
    users: users.filter((u) => u.id === actor.id || canManage(actor, u)),
    offices: isSuperAdmin(actor.role) ? await availableOffices() : actor.office ? [actor.office] : [],
  });
});

export const POST = handler(async (req: Request) => {
  const actor = await actorOf();
  const body = await parseBody(
    req,
    z.object({
      email: z.string().trim().toLowerCase().email(),
      password,
      role: role.default("VIEWER"),
      office,
    }),
  );
  const assigned = checkAssignment(actor, body.role, body.office);
  if ("error" in assigned) throw new HttpError(403, assigned.error);
  await checkOffice(assigned.office);
  if (await prisma.user.findFirst({ where: { email: { equals: body.email, mode: "insensitive" } } })) {
    throw new HttpError(409, "A user with this email already exists");
  }
  const user = await prisma.user.create({
    data: {
      email: body.email,
      role: body.role,
      office: assigned.office,
      passwordHash: await bcrypt.hash(body.password, 12),
    },
    select,
  });
  return NextResponse.json({ user }, { status: 201 });
});

/** Change role / office and/or reset password of a managed account. */
export const PATCH = handler(async (req: Request) => {
  const actor = await actorOf();
  const body = await parseBody(
    req,
    z.object({ id: z.number().int(), role: role.optional(), office, password: password.optional() }),
  );
  const current = await target(actor, body.id);
  let data: { role?: Account["role"]; office?: string | null } = {};
  if (body.role !== undefined || body.office !== undefined) {
    const nextRole = body.role ?? current.role;
    const assigned = checkAssignment(
      actor,
      nextRole,
      body.office === undefined ? current.office : body.office,
    );
    if ("error" in assigned) throw new HttpError(403, assigned.error);
    await checkOffice(assigned.office);
    data = { role: nextRole, office: assigned.office };
  }
  const user = await prisma.user.update({
    where: { id: body.id },
    data: {
      ...data,
      ...(body.password ? { passwordHash: await bcrypt.hash(body.password, 12) } : {}),
    },
    select,
  });
  return NextResponse.json({ user });
});

export const DELETE = handler(async (req: Request) => {
  const actor = await actorOf();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) throw new HttpError(400, "id required");
  await target(actor, id);
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ deleted: id });
});
