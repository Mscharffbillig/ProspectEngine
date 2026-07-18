import { NextResponse, type NextRequest } from "next/server";
import { stackConfigured, stackServerApp } from "@/stack";

export async function middleware(request: NextRequest) {
  if (!stackConfigured()) {
    // Neon Auth not set up yet: run open (single-user local/demo state).
    return NextResponse.next();
  }
  const user = await stackServerApp().getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/handler/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!handler|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)",
  ],
};
