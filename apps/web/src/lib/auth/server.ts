import { createNeonAuth } from "@neondatabase/auth/next/server";

// Lazy so builds and the zero-credential demo mode work without Neon Auth env
// vars. Env: NEON_AUTH_BASE_URL (from the Neon Console Auth page) and
// NEON_AUTH_COOKIE_SECRET (any 32+ char secret).
let _auth: ReturnType<typeof createNeonAuth> | null = null;

export function authConfigured(): boolean {
  return Boolean(
    process.env.NEON_AUTH_BASE_URL &&
      process.env.NEON_AUTH_COOKIE_SECRET &&
      process.env.NEON_AUTH_COOKIE_SECRET.length >= 32,
  );
}

export function neonAuth(): ReturnType<typeof createNeonAuth> {
  if (_auth === null) {
    _auth = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL ?? "",
      cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET ?? "" },
    });
  }
  return _auth;
}

/** Current session user, or null when auth is unconfigured or signed out. */
export async function currentUser(): Promise<{ name?: string | null; email: string } | null> {
  if (!authConfigured()) return null;
  const { data: session } = await neonAuth().getSession();
  return session?.user ?? null;
}
