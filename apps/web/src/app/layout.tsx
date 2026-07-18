import type { Metadata } from "next";
import Link from "next/link";
import { StackProvider, StackTheme } from "@stackframe/stack";
import "./globals.css";
import { stackConfigured, stackServerApp } from "@/stack";

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
    <header className="border-b border-gray-200 bg-white">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3"
      >
        <span className="font-semibold">ProspectEngine</span>
        {NAV_LINKS.map(([href, label]) => (
          <Link key={href} href={href} className="text-sm text-gray-600 hover:text-gray-900">
            {label}
          </Link>
        ))}
        {showSignOut && (
          <Link
            href="/handler/sign-out"
            className="ml-auto text-sm text-gray-500 hover:text-gray-900"
          >
            Sign out
          </Link>
        )}
      </nav>
    </header>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  if (!stackConfigured()) {
    // Neon Auth not set up yet: run open with a visible warning banner.
    return (
      <html lang="en">
        <body className="min-h-screen bg-gray-50 text-gray-900">
          <div className="bg-yellow-100 px-4 py-1.5 text-center text-xs text-yellow-900">
            Neon Auth is not configured — the app is running without sign-in. Set the STACK env
            vars (see .env.example) to enable authentication.
          </div>
          <Nav showSignOut={false} />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </body>
      </html>
    );
  }

  const app = stackServerApp();
  const user = await app.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <StackProvider app={app}>
          <StackTheme>
            {user && <Nav showSignOut />}
            <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          </StackTheme>
        </StackProvider>
      </body>
    </html>
  );
}
