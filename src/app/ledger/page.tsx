import Link from "next/link";
import { all } from "@/lib/db";
import { verifyLedger } from "@/lib/ledger";
import { fmtDate } from "@/components/ui";

export const metadata = { title: "Public ledger" };

export default async function LedgerPage() {
  const check = verifyLedger();
  const rows = all<{ seq: number; contribution_id: string; number: number; title: string; content_hash: string; chain_hash: string; created_at: string }>(
    "SELECT seq, contribution_id, number, title, content_hash, chain_hash, created_at FROM versions ORDER BY seq DESC LIMIT 200",
  );
  const reviewRows = all<{ seq: number; review_id: string; reviewer: string; title: string; chain_hash: string; created_at: string }>(
    `SELECT l.seq, l.review_id, u.display_name AS reviewer, v.title, l.chain_hash, l.created_at
     FROM review_ledger l JOIN reviews r ON r.id = l.review_id JOIN users u ON u.id = r.reviewer_id
     JOIN versions v ON v.contribution_id = r.contribution_id AND v.number = r.version_number
     ORDER BY l.seq DESC LIMIT 100`,
  );

  const collectionRows = all<{ seq: number; kind: string; slug: string; name: string; actor: string; chain_hash: string; created_at: string }>(
    `SELECT l.seq, l.kind, co.slug, co.name, u.display_name AS actor, l.chain_hash, l.created_at
     FROM collection_log l JOIN collections co ON co.id = l.collection_id JOIN users u ON u.id = l.actor_id
     ORDER BY l.seq DESC LIMIT 100`,
  );

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-3">
        <h1 className="font-serif text-3xl font-bold">The public ledger</h1>
        <p className="text-muted">
          Every version of every contribution is appended to a single hash chain. Each entry commits to its content and
          to every entry before it, so no one — including Fjournal — can quietly alter, backdate or delete work. This is
          your proof of priority. Reviews are publications too, so they have a chain of their own: no review can be edited
          or backdated after it is written. A third chain records every editorial board change and decision in every
          collection, so no board can rewrite who selected what, on which version, under which policy.
        </p>
        <div
          className={`card flex flex-wrap items-center gap-3 p-4 text-sm ${check.ok ? "border-emerald-600/40" : "border-red-600/50"}`}
        >
          <span className={`text-lg ${check.ok ? "text-emerald-600" : "text-red-600"}`}>{check.ok ? "✓" : "✗"}</span>
          <span>
            {check.ok
              ? `All chains verified just now: ${check.versions.checked} versions, ${check.reviews.checked} reviews and ${check.collections.checked} collection entries recomputed from stored content.`
              : `Verification failed${check.firstBadSeq ? ` at entry #${check.firstBadSeq}` : ""}: ${check.reason}.`}
          </span>
          <a href="/api/ledger" className="ml-auto text-accent underline">Download full ledger (JSON)</a>
        </div>
        <p className="text-xs text-muted">
          Roadmap: periodic anchoring of the chain head to OpenTimestamps and Zenodo so priority survives even if
          Fjournal does not.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Contribution</th>
              <th className="px-4 py-2">Timestamp (UTC)</th>
              <th className="px-4 py-2">Chain hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.seq}>
                <td className="px-4 py-2 font-mono text-xs">{r.seq}</td>
                <td className="max-w-md px-4 py-2">
                  <Link href={`/c/${r.contribution_id}?v=${r.number}`} className="line-clamp-1 hover:text-accent">
                    {r.title}
                  </Link>
                  <span className="font-mono text-xs text-muted">fj:{r.contribution_id} v{r.number}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-2"><span className="hash">{r.chain_hash}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-serif text-2xl font-semibold">Review chain</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Review</th>
              <th className="px-4 py-2">Timestamp (UTC)</th>
              <th className="px-4 py-2">Chain hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {reviewRows.map((r) => (
              <tr key={r.seq}>
                <td className="px-4 py-2 font-mono text-xs">{r.seq}</td>
                <td className="max-w-md px-4 py-2">
                  <Link href={`/r/${r.review_id}`} className="line-clamp-1 hover:text-accent">Review of &ldquo;{r.title}&rdquo;</Link>
                  <span className="text-xs text-muted">by {r.reviewer}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-2"><span className="hash">{r.chain_hash}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-serif text-2xl font-semibold">Collection chain</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Entry</th>
              <th className="px-4 py-2">Timestamp (UTC)</th>
              <th className="px-4 py-2">Chain hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {collectionRows.map((r) => (
              <tr key={r.seq}>
                <td className="px-4 py-2 font-mono text-xs">{r.seq}</td>
                <td className="max-w-md px-4 py-2">
                  <Link href={`/j/${r.slug}/log#e${r.seq}`} className="line-clamp-1 hover:text-accent">{r.name}: {r.kind.replace(/_/g, " ")}</Link>
                  <span className="text-xs text-muted">by {r.actor}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-2"><span className="hash">{r.chain_hash}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
