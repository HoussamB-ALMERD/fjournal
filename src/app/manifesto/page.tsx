import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { Markdown } from "@/components/Markdown";

export const metadata = { title: "Why Fjournal exists" };

// Single source of truth: the manifesto lives in docs/MANIFESTO.md and is rendered here unchanged.
export default async function ManifestoPage() {
  const text = await fs.readFile(path.join(process.cwd(), "docs", "MANIFESTO.md"), "utf8");
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <article className="[&_.prose-fj]:text-[17px] [&_.prose-fj]:leading-8 [&_h1]:text-4xl! [&_h1]:font-bold">
        <Markdown>{text}</Markdown>
      </article>
      <div className="flex gap-3 border-t border-line pt-6">
        <Link href="/submit" className="btn">Publish your work</Link>
        <Link href="/about" className="btn-ghost">How it works</Link>
      </div>
    </div>
  );
}
