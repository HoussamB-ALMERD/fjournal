import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { ROLES, boardOf, getCollection, logOf, roleOf, type LogEntry, type Role } from "@/lib/collections";
import { verifyLedger } from "@/lib/ledger";
import { CollectionHeader } from "@/components/CollectionHeader";
import { UserLink, fmtDate } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/j/[slug]/log">): Promise<Metadata> {
  const { slug } = await params;
  const c = getCollection(slug);
  return c ? { title: `Log · ${c.name}` } : {};
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function Subject({ e }: { e: LogEntry }) {
  if (e.subject_handle) return <UserLink handle={e.subject_handle} name={e.subject_label ?? undefined} />;
  if (e.subject && e.subject_label)
    return (
      <Link href={`/c/${e.subject}${typeof e.payload.version === "number" ? `?v=${e.payload.version}` : ""}`} className="font-medium hover:text-accent">
        &ldquo;{e.subject_label}&rdquo;
      </Link>
    );
  return <span className="text-muted">{e.subject ? `fj:${e.subject} (removed by moderation)` : "the collection"}</span>;
}

function Sentence({ e }: { e: LogEntry }) {
  const who = <UserLink handle={e.actor_handle} name={e.actor_name} />;
  const v = typeof e.payload.version === "number" ? ` (version ${e.payload.version})` : "";
  const role = ROLES[e.payload.role as Role]?.label.toLowerCase();
  switch (e.kind) {
    case "founded": return <>{who} founded the collection as its managing editor.</>;
    case "policy": return <>{who} changed the collection&apos;s published settings.</>;
    case "invited": return <>{who} invited <Subject e={e} /> to join as {role}.</>;
    case "joined": return <><Subject e={e} /> accepted and joined the board.</>;
    case "declined_invite": return <><Subject e={e} /> declined the invitation.</>;
    case "left": return <><Subject e={e} /> left the board.</>;
    case "removed": return e.payload.was === "invited" ? <>{who} withdrew the invitation to <Subject e={e} />.</> : <>{who} removed <Subject e={e} /> from the board.</>;
    case "role": return <>{who} made <Subject e={e} /> {role}.</>;
    case "submitted": return e.payload.nominated ? <>{who} nominated <Subject e={e} />{v}.</> : <>{who} submitted <Subject e={e} />{v}.</>;
    case "withdrawn": return e.payload.by === "board" ? <>{who} dropped the nomination of <Subject e={e} />.</> : <>{who}, an author, withdrew <Subject e={e} />.</>;
    case "selected": return <>{who} <strong>selected</strong> <Subject e={e} />{v}.</>;
    case "declined": return <>{who} did <strong>not select</strong> <Subject e={e} />{v}.</>;
    case "deselected": return <>{who} <strong>withdrew the selection</strong> of <Subject e={e} />.</>;
    default: return <>{who}: {e.kind}</>;
  }
}

function Details({ e }: { e: LogEntry }) {
  const p = e.payload;
  const note = str(p.note) || str(p.reason);
  const isDecision = e.kind === "selected" || e.kind === "declined";
  return (
    <>
      {note && <p className="whitespace-pre-line rounded-md bg-paper p-3 text-sm leading-6">{note}</p>}
      {isDecision && (
        <dl className="grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-[170px_1fr]">
          <dt>Competing interests</dt>
          <dd className={str(p.competing_interests) ? "text-ink" : ""}>{str(p.competing_interests) || "None declared"}</dd>
          <dt>Public reviews at the time</dt>
          <dd>
            {Array.isArray(p.reviews) && p.reviews.length > 0
              ? (p.reviews as string[]).map((id, i) => (
                  <span key={id}>{i > 0 && ", "}<Link href={`/r/${id}`} className="underline">{id}</Link></span>
                ))
              : "none"}
          </dd>
          <dt>Version content hash</dt>
          <dd className="hash">{str(p.version_content_hash)}</dd>
          <dt>Policy in force (hash)</dt>
          <dd className="hash">{str(p.policy_hash)}</dd>
        </dl>
      )}
      {(e.kind === "policy" || e.kind === "founded") && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Settings recorded in this entry</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[150px_1fr]">
            <dt>Name</dt><dd className="text-ink">{str(p.name)}</dd>
            <dt>Scope</dt><dd className="whitespace-pre-line text-ink">{str(p.scope)}</dd>
            <dt>Selection criteria</dt><dd className="whitespace-pre-line text-ink">{str(p.policy)}</dd>
            <dt>Reviews required</dt><dd className="text-ink">{String(p.min_reviews)}</dd>
            <dt>Submissions</dt><dd className="text-ink">{p.accepts_submissions ? "open to authors" : "nominations only"}</dd>
            <dt>Lineage claim</dt>
            <dd className="text-ink">
              {p.continues && typeof p.continues === "object"
                ? `${str((p.continues as Record<string, unknown>).journal)} — ${str((p.continues as Record<string, unknown>).statement_url)}`
                : "none"}
            </dd>
          </dl>
        </details>
      )}
    </>
  );
}

export default async function CollectionLogPage({ params }: PageProps<"/j/[slug]/log">) {
  const { slug } = await params;
  const c = getCollection(slug);
  if (!c) notFound();
  const me = await currentUser();
  const board = boardOf(c.id);
  const entries = logOf(c.id);
  const check = verifyLedger().collections;

  return (
    <div className="space-y-8">
      <CollectionHeader c={c} tab="log" isBoard={!!roleOf(c.id, me?.id)} board={board.length} verified={board.filter((m) => m.orcid).length} />
      <div className="max-w-3xl space-y-3">
        <p className="text-sm text-muted">
          Every change to the board and every editorial decision, newest first. Each entry is hashed into Fjournal&apos;s
          collection chain, so no entry can be edited, backdated or removed, and the collection&apos;s current state is
          checked against this log.
        </p>
        <div className={`card flex flex-wrap items-center gap-3 p-3 text-sm ${check.ok ? "border-emerald-600/40" : "border-red-600/50"}`}>
          <span className={check.ok ? "text-emerald-600" : "text-red-600"}>{check.ok ? "✓" : "✗"}</span>
          <span>
            {check.ok
              ? `Collection chain verified just now (${check.checked} entries across all collections), and every board and selection matches its log.`
              : `Verification failed: ${check.reason}.`}
          </span>
        </div>
      </div>
      <ol className="space-y-3">
        {entries.map((e) => (
          <li key={e.seq} id={`e${e.seq}`} className="card space-y-3 p-4 target:ring-2 target:ring-accent/40">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-xs text-muted">#{e.seq}</span>
              <span className="min-w-0 flex-1"><Sentence e={e} /></span>
              <span className="text-xs text-muted">{fmtDate(e.created_at)}</span>
            </div>
            <Details e={e} />
            <p className="hash" title="Chain hash">{e.chain_hash}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
