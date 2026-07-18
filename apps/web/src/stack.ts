import { StackServerApp } from "@stackframe/stack";

// Lazy so builds without Neon Auth env vars still succeed; instantiated on
// first request. Env: NEXT_PUBLIC_STACK_PROJECT_ID,
// NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY, STACK_SECRET_SERVER_KEY.
let _app: ReturnType<typeof createApp> | null = null;

function createApp() {
  return new StackServerApp({
    tokenStore: "nextjs-cookie",
    urls: { afterSignIn: "/", afterSignOut: "/handler/sign-in" },
  });
}

export function stackServerApp(): ReturnType<typeof createApp> {
  if (_app === null) {
    _app = createApp();
  }
  return _app;
}

/**
 * Whether Neon Auth env vars are present. When false the app runs without
 * authentication (local demo / pre-setup state) and shows a warning banner;
 * the middleware lets requests through so the tool stays usable.
 */
export function stackConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_STACK_PROJECT_ID &&
      process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY &&
      process.env.STACK_SECRET_SERVER_KEY,
  );
}
