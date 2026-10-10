import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { publicUrl } from "@/lib/config";
import { PERIODS, buildReport } from "@/lib/report";
import { ScrutinyReport } from "@/components/ScrutinyReport";
import { PrintButton } from "@/components/PrintButton";
import { FreezeReportForm } from "@/components/forms";

export async function generateMetadata({ params }: PageProps<"/u/[handle]/report">): Promise<Metadata> {
  const { handle } = await params;
  return { title: `Scrutiny report · @${handle}`, robots: { index: false } };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/u/[handle]/report">) {
  const { handle } = await params;
  const { years: y } = await searchParams;
  const years = PERIODS.find((p) => String(p) === y) ?? null;
  const data = buildReport(handle, years);
  if (!data) notFound();
  const me = await currentUser();
  const base = await publicUrl();
  const own = me?.handle === data.researcher.handle;

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-[210mm] space-y-3 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-2xl font-bold">Scrutiny report</h1>
          <span className="ml-auto flex flex-wrap gap-1 text-sm">
            {[null, ...PERIODS].map((p) => (
              <Link
                key={p ?? "all"}
                href={p ? `/u/${handle}/report?years=${p}` : `/u/${handle}/report`}
                className={`rounded-md border px-2.5 py-1 ${years === p ? "border-accent font-semibold text-accent" : "border-line text-muted hover:text-ink"}`}
              >
                {p ? `Last ${p} years` : "Whole record"}
              </Link>
            ))}
          </span>
        </div>
        <p className="text-sm text-muted">
          One page for hiring and funding committees: how this person&apos;s work held up under open scrutiny, and what they
          gave back as a reviewer, replicator and editor. Print it, or freeze it to get a permanent link and a hash anyone can
          use to check that a copy hasn&apos;t been altered.
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <PrintButton />
          {me ? (
            <FreezeReportForm handle={handle} years={years} />
          ) : (
            <Link href={`/login?next=/u/${handle}/report`} className="btn-ghost">Sign in to freeze a verifiable copy</Link>
          )}
          {own && <Link href="/settings#report" className="btn-ghost">Edit your statement and highlights</Link>}
          <a href={`/api/researchers/${handle}/report${years ? `?years=${years}` : ""}`} className="self-center text-xs text-muted underline">JSON</a>
        </div>
      </div>
      <ScrutinyReport data={data} base={base} />
    </div>
  );
}
