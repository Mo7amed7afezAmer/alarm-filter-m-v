import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string; role: "VIEWER" | "ADMIN" };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "VIEWER" | "ADMIN";
  }
}
