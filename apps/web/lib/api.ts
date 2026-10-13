// Shared helpers for Route Handlers: auth guards, zod query parsing, pagination, errors.
import { getServerSession, type Session } from "next-auth";
import { NextResponse } from "next/server";
import { z, type ZodTypeAny } from "zod";
import { authOptions, hasRole, type Role } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Throws 401 when not signed in, 403 when the user's role is below `role`. */
export async function requireUser(role?: Role): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new HttpError(401, "Not signed in");
  if (role && !hasRole(session.user.role, role))
    throw new HttpError(403, role === "ADMIN" ? "Admin only" : `${role.toLowerCase()} role required`);
  return session;
}

export function parseQuery<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const r = schema.safeParse(params);
  if (!r.success) throw new HttpError(400, "Invalid query", r.error.flatten().fieldErrors);
  return r.data;
}

export async function parseBody<T extends ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new HttpError(400, "Invalid body", r.error.flatten());
  return r.data;
}

/** Wraps a handler: converts HttpError / unexpected errors into JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(
          { error: err.message, details: err.details },
          { status: err.status },
        );
      }
      console.error(err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

// ---- common query schemas ----

export const category = z.enum(["DOWN", "POWER", "OTHER"]);

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
};

/** Accepts YYYY-MM-DD (start of that day in ALARM_TZ is NOT applied — UTC midnight) or ISO. */
export const dateParam = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date")
  .transform((s) => new Date(s));

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const ALARM_TZ = process.env.ALARM_TZ || "Africa/Cairo";
