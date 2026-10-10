import Link from "next/link";
import {
  CONTRIBUTION_TYPES,
  LICENSES,
  SOURCE_KINDS,
  licenseLabelFromUrl,
  type ContributionType,
  type License,
  type SourceRecord,
} from "@/lib/constants";
import type { Badge as BadgeT, Scrutiny } from "@/lib/scrutiny";

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "minute"], [3600, "hour"], [86400, "day"], [2592000, "month"], [31536000, "year"],
  ];
  for (let i = units.length - 1; i >= 0; i--) {
    const [secs, name] = units[i];
    if (s >= secs) {
      const n = Math.floor(s / secs);
      return `${n} ${name}${n > 1 ? "s" : ""} ago`;
    }
  }
  return "just now";
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

const TYPE_STYLE: Partial<Record<ContributionType, string>> = {
  replication: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  negative_result: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

export function TypeTag({ type }: { type: ContributionType }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        TYPE_STYLE[type] ?? "bg-accent-soft text-accent"
      }`}
    >
      {CONTRIBUTION_TYPES[type].label}
    </span>
  );
}

export function LicenseTag({ license, source }: { license: License; source?: SourceRecord | null }) {
  const cls = "rounded border border-line px-1.5 py-0.5 text-[11px] text-muted";
  if (license === "EXTERNAL" && source) {
    const label = licenseLabelFromUrl(source.license_url);
    return source.license_url ? (
      <a href={source.license_url} className={`${cls} hover:text-ink`} target="_blank" rel="noreferrer" title="License set at the source">
        {label}
      </a>
    ) : (
      <span className={cls} title="License set at the source">{label}</span>
    );
  }
  const l = LICENSES[license];
  return l.url ? (
    <a href={l.url} className={`${cls} hover:text-ink`} target="_blank" rel="noreferrer" title={l.summary}>
      {l.label}
    </a>
  ) : (
    <span className={cls} title={l.summary}>{l.label}</span>
  );
}

const BADGE_STYLE: Record<BadgeT["key"], string> = {
  open: "border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  computed: "border-teal-600/50 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  scrutinized: "border-blue-600/40 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  replicated: "border-violet-600/40 bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  contested: "border-amber-600/40 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export function Badges({ badges }: { badges: BadgeT[] }) {
  return (
    <>
      {badges.map((b) => (
        <span key={b.key} title={b.rule} className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${BADGE_STYLE[b.key]}`}>
          {b.label}
        </span>
      ))}
    </>
  );
}

export function ScrutinyLine({ s }: { s: Scrutiny }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span>{s.reviewCount} review{s.reviewCount === 1 ? "" : "s"}</span>
      {s.soundness !== null && <span>soundness {s.soundness.toFixed(1)}/5</span>}
      <span>
        {s.reproduced + s.partial + s.failed} replication{s.reproduced + s.partial + s.failed === 1 ? "" : "s"}
      </span>
      <span>{s.endorsements} endorsement{s.endorsements === 1 ? "" : "s"}</span>
      <span>v{s.versions}</span>
      <span className={s.hasData ? "text-ink" : "line-through opacity-60"}>data</span>
      <span className={s.hasCode ? "text-ink" : "line-through opacity-60"}>code</span>
    </div>
  );
}

export function UserLink({ handle, name }: { handle: string; name?: string }) {
  return (
    <Link href={`/u/${handle}`} className="font-medium hover:text-accent">
      {name ?? `@${handle}`}
    </Link>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="font-mono text-xs" aria-label={`${value} out of 5`}>
      {"●".repeat(value)}
      <span className="opacity-25">{"●".repeat(5 - value)}</span>
    </span>
  );
}

/** Where an imported work was published: "arXiv", "bioRxiv", or the journal's name. */
export const venueName = (s: SourceRecord) => (s.kind === "doi" ? s.venue || "DOI" : SOURCE_KINDS[s.kind]);

/** Retractions, expressions of concern and withdrawals registered by the publisher. */
export const seriousNotices = (s: SourceRecord) =>
  s.notices.filter((n) => /retract|withdraw|concern|removal/i.test(n.type));

export function SourceTag({ source }: { source: SourceRecord }) {
  return (
    <span
      title="Published elsewhere and opened for review on Fjournal"
      className="rounded border border-amber-600/40 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      Imported · {venueName(source)}
    </span>
  );
}

export function NoticeTag({ type }: { type: string }) {
  return (
    <span className="rounded-full bg-red-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
      Publisher: {type.replace(/[_-]/g, " ")}
    </span>
  );
}

/** "Selected · Name": a board's public judgement, kept visually apart from the evidence badges. */
export function CollectionChip({ c }: { c: { slug: string; name: string; accent: string } }) {
  return (
    <Link
      href={`/j/${c.slug}`}
      title={`Selected by the editorial board of ${c.name}. Read their reasoning in the collection's public log.`}
      className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] font-medium hover:border-ink/40"
    >
      <span className="h-2 w-2 rounded-full" style={{ background: c.accent }} aria-hidden />
      Selected · {c.name}
    </Link>
  );
}

/** Shown only for iDs proven through ORCID sign-in. */
export function OrcidBadge({ orcid }: { orcid: string }) {
  return (
    <a
      href={`https://orcid.org/${orcid}`}
      target="_blank"
      rel="noreferrer"
      title="ORCID iD verified by signing in with ORCID"
      className="inline-flex items-center gap-1 rounded border border-[#a6ce39]/60 px-1.5 py-0.5 font-mono text-[11px] text-[#5c7a14] hover:underline dark:text-[#a6ce39]"
    >
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#a6ce39] text-[8px] font-bold text-white">iD</span>
      {orcid} ✓
    </a>
  );
}
