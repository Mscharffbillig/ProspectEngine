import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

export const metadata: Metadata = {
  title: "Lead Generator",
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {user && (
          <header className="border-b border-gray-200 bg-white">
            <nav
              aria-label="Main navigation"
              className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3"
            >
              <span className="font-semibold">Lead Generator</span>
              {NAV_LINKS.map(([href, label]) => (
                <Link key={href} href={href} className="text-sm text-gray-600 hover:text-gray-900">
                  {label}
                </Link>
              ))}
              <form action={signOut} className="ml-auto">
                <button type="submit" className="text-sm text-gray-500 hover:text-gray-900">
                  Sign out
                </button>
              </form>
            </nav>
          </header>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
