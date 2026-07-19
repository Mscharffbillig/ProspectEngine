import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { authConfigured, currentUser } from "@/lib/auth/server";
import { signOutAction } from "@/lib/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";

// Applied before paint so a saved dark preference doesn't flash light.
const THEME_INIT_SCRIPT = `try{if(localStorage.theme==="dark"||(!("theme" in localStorage)&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: "ProspectEngine",
  description: "Automated lead discovery and research",
};

const NAV_LINKS = [
  ["/", "Dashboard"],
  ["/review", "Review"],
  ["/campaigns", "Campaigns"],
  ["/outreach", "Outreach"],
  ["/import", "Import"],
  ["/settings", "Settings"],
] as const;

function Nav({ showSignOut }: { showSignOut: boolean }) {
  return (
    <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3"
      >
        <span className="font-semibold">ProspectEngine</span>
        {NAV_LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
            {label}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {showSignOut && (
            <form action={signOutAction}>
              <button type="submit" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
                Sign out
              </button>
            </form>
          )}
        </span>
      </nav>
    </header>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const configured = authConfigured();
  const user = configured ? await currentUser() : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        {!configured && (
          <div className="bg-yellow-100 px-4 py-1.5 text-center text-xs text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200">
            Neon Auth is not configured — the app is running without sign-in. Set
            NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET (see .env.example) to enable
            authentication.
          </div>
        )}
        {(user || !configured) && <Nav showSignOut={Boolean(user)} />}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
