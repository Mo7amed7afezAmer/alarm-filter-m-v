// Pages require sign-in. API routes do their own checks (401/403 JSON instead of redirects).
export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
