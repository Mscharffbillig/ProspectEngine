import { neonAuth } from "@/lib/auth/server";

// Lazily create the handlers so builds without Neon Auth env vars succeed.
type Handler = (req: Request, ctx: unknown) => Promise<Response> | Response;

export const GET: Handler = (req, ctx) => (neonAuth().handler().GET as Handler)(req, ctx);
export const POST: Handler = (req, ctx) => (neonAuth().handler().POST as Handler)(req, ctx);
