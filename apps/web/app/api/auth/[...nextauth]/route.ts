import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const nextAuth = NextAuth(authOptions);

export { nextAuth as GET, nextAuth as POST };
