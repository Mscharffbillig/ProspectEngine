import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, neonAuth } from "@/lib/auth/server";

// Next 16 proxy (formerly middleware): validates the Neon Auth session cookie
// and redirects signed-out visitors to the sign-in page. When Neon Auth env
// vars are absent the app runs open (local demo state) with a banner.
//
// Applied to GET/HEAD navigations only: the SDK middleware 307s every POST,
// which breaks Next server actions. Actions enforce auth themselves via
// requireUser() in src/lib/auth/server.ts.
export default async function proxy(request: NextRequest) {
  if (!authConfigured() || (request.method !== "GET" && request.method !== "HEAD")) {
    return NextResponse.next();
  }
  const middleware = neonAuth().middleware({ loginUrl: "/auth/sign-in" });
  return middleware(request);
}

export const config = {
  matcher: [
    "/((?!api/auth|auth/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)",
  ],
};
