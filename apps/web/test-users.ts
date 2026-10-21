// Integration-test accounts: requireUser() reads role + office from the users table, so a mocked
// session must point at a real row. Emails start with the given prefix; removeTestUsers() deletes
// exactly those.
import type { PrismaClient } from "@alarm/db";
import { ROLES, type Role } from "./lib/roles";

export type TestUsers = Record<Role, string>;

export async function createTestUsers(
  prisma: PrismaClient,
  prefix: string,
  office: string | null,
): Promise<TestUsers> {
  await removeTestUsers(prisma, prefix);
  const ids = {} as TestUsers;
  for (const role of ROLES) {
    const u = await prisma.user.create({
      data: {
        email: `${prefix.toLowerCase()}-${role.toLowerCase()}@test.local`,
        passwordHash: "x",
        role,
        office: role === "SUPER_ADMIN" ? null : office,
      },
    });
    ids[role] = String(u.id);
  }
  return ids;
}

export async function removeTestUsers(prisma: PrismaClient, prefix: string): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { startsWith: `${prefix.toLowerCase()}-` } } });
}
