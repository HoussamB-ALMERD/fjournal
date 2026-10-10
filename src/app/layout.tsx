import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { logout } from "./actions";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Fjournal — open science, judged in the open", template: "%s · Fjournal" },
  description:
    "Publish instantly. Keep your copyright. Get evaluated by the whole community, not three anonymous gatekeepers. Zero fees, forever.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const me = await currentUser();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur print:hidden">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="font-serif text-xl font-bold tracking-tight">
              F<span className="text-accent">journal</span>
            </Link>
            <nav className="hidden gap-5 text-sm text-muted sm:flex">
              <Link href="/" className="hover:text-ink">Explore</Link>
              <Link href="/import" className="hover:text-ink">Review any paper</Link>
              <Link href="/collections" className="hover:text-ink">Collections</Link>
              <Link href="/manifesto" className="hover:text-ink">Why we exist</Link>
              <Link href="/ledger" className="hover:text-ink">Ledger</Link>
              <Link href="/about" className="hover:text-ink">How it works</Link>
            </nav>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <Link href="/submit" className="btn py-1.5">Submit work</Link>
              {me ? (
                <>
                  <Link href={`/u/${me.handle}`} className="font-medium hover:text-accent">@{me.handle}</Link>
                  <form action={logout}>
                    <button className="text-muted hover:text-ink">Sign out</button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="font-medium hover:text-accent">Sign in</Link>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 print:max-w-none print:p-0">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-muted print:hidden">
          Fjournal · Zero author fees. Zero reader fees. Authors keep their copyright. ·{" "}
          <Link href="/moderation" className="underline">Moderation log</Link> ·{" "}
          <Link href="/tools/check" className="underline">Statistics checker</Link> ·{" "}
          <Link href="/tools/reproduce" className="underline">Reproducibility bot</Link> ·{" "}
          <Link href="/journals" className="underline">Journal Integrity Index</Link> ·{" "}
          <Link href="/api/contributions" className="underline">Open API</Link> ·{" "}
          <Link href="/api/ledger" className="underline">Ledger export</Link> ·{" "}
          <Link href="/api/collections" className="underline">Collections API</Link>
        </footer>
      </body>
    </html>
  );
}
