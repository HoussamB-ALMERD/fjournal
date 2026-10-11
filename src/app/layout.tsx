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
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
          Skip to content
        </a>
        <header className="sticky top-0 z-10 border-b border-line bg-paper print:hidden">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
            <Link href="/" className="font-serif text-[1.35rem] font-semibold tracking-[-0.02em]">
              <span className="text-brand">F</span>journal
            </Link>
            <nav aria-label="Main" className="hidden gap-6 text-sm text-muted md:flex">
              <Link href="/" className="transition-colors hover:text-ink">Explore</Link>
              <Link href="/collections" className="transition-colors hover:text-ink">Collections</Link>
              <Link href="/import" className="transition-colors hover:text-ink">Review a paper</Link>
              <Link href="/ledger" className="transition-colors hover:text-ink">Ledger</Link>
              <Link href="/about" className="transition-colors hover:text-ink">How it works</Link>
            </nav>
            <div className="ml-auto flex items-center gap-5 text-sm">
              {me ? (
                <>
                  <Link href={`/u/${me.handle}`} className="hidden font-medium hover:underline sm:inline">@{me.handle}</Link>
                  <form action={logout}>
                    <button className="text-muted transition-colors hover:text-ink">Sign out</button>
                  </form>
                </>
              ) : (
                <Link href="/login" className="text-muted transition-colors hover:text-ink">Sign in</Link>
              )}
              <Link href="/submit" className="btn h-8 px-3">Submit</Link>
            </div>
          </div>
          <nav aria-label="Main" className="flex gap-5 overflow-x-auto border-t border-line px-4 py-2.5 text-sm whitespace-nowrap text-muted [scrollbar-width:none] md:hidden">
            <Link href="/">Explore</Link>
            <Link href="/collections">Collections</Link>
            <Link href="/import">Review a paper</Link>
            <Link href="/ledger">Ledger</Link>
            <Link href="/about">How it works</Link>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 print:max-w-none print:p-0">{children}</main>
        <footer className="mt-16 border-t border-line print:hidden">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <p className="font-serif text-lg font-semibold"><span className="text-brand">F</span>journal</p>
              <p className="mt-2 max-w-xs leading-relaxed text-muted">
                No author fees, no reader fees. Authors keep their copyright, and every decision is on a public ledger.
              </p>
            </div>
            <FooterCol title="Platform" links={[["Why we exist", "/manifesto"], ["How it works", "/about"], ["Moderation log", "/moderation"], ["Ledger", "/ledger"]]} />
            <FooterCol title="Tools" links={[["Statistics checker", "/tools/check"], ["Reproducibility bot", "/tools/reproduce"], ["Journal Integrity Index", "/journals"]]} />
            <FooterCol title="Open data" links={[["Contributions API", "/api/contributions"], ["Ledger export", "/api/ledger"], ["Collections API", "/api/collections"]]} />
          </div>
        </footer>
      </body>
    </html>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="kicker">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-muted transition-colors hover:text-ink">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
