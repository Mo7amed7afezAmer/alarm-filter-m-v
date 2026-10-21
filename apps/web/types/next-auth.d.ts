import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: "VIEWER" | "OPERATOR" | "ADMIN" | "SUPER_ADMIN";
      /** Set by requireUser() from the users table (not stored in the JWT). */
      office?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "VIEWER" | "OPERATOR" | "ADMIN" | "SUPER_ADMIN";
  }
}
