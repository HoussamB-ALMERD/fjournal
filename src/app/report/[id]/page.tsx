import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicUrl } from "@/lib/config";
import { frozenReport } from "@/lib/report";
import { ScrutinyReport } from "@/components/ScrutinyReport";
import { PrintButton } from "@/components/PrintButton";
import { fmtDate } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/report/[id]">): Promise<Metadata> {
  const { id } = await params;
  const r = frozenReport(id);
  return { title: r ? `Scrutiny report of ${r.data.researcher.name} (frozen)` : "Not found", robots: { index: false } };
}

export default async function FrozenReportPage({ params }: PageProps<"/report/[id]">) {
  const { id } = await params;
  const r = frozenReport(id);
  if (!r) notFound();
  const base = await publicUrl();
  const live = `/u/${r.handle}/report${r.data.period.years ? `?years=${r.data.period.years}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="mx-auto max-w-[210mm] space-y-3 print:hidden">
        <div className={`card space-y-2 p-4 text-sm ${r.intact ? "border-emerald-600/40" : "border-red-600/60"}`}>
          <p className="font-semibold">
            {r.intact ? "✓ Genuine frozen report" : "✗ This snapshot does not match its recorded hash"}
          </p>
          <p className="text-muted">
            Frozen on {fmtDate(r.created_at)} by @{r.requested_by_handle}. Compare any copy you received with this page: the
            figures and the hash must be identical.
          </p>
          <p className="hash">sha256 {r.content_hash}</p>
          <p className="text-xs text-muted">
            The hash is SHA-256 over the canonical JSON (keys sorted) of the report data, which you can download from{" "}
            <a href={`/api/reports/${r.id}`} className="underline">/api/reports/{r.id}</a> and recompute yourself.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <PrintButton />
          <Link href={live} className="btn-ghost">See today&apos;s record</Link>
        </div>
      </div>
      <ScrutinyReport data={r.data} base={base} frozen={{ id: r.id, hash: r.content_hash, intact: r.intact }} />
    </div>
  );
}
