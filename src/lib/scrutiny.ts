import type { Artifact } from "./ledger";
import type { ReplicationOutcome } from "./constants";

export type ScrutinyInput = {
  reviews: { reviewer_id: string; soundness: number; reproducibility: number; weight: number }[];
  replications: { outcome: ReplicationOutcome | null }[];
  endorsements: number;
  artifacts: Artifact[];
  versions: number;
  computational?: boolean; // the reproducibility bot reproduced every declared result of the latest version
};

export type Badge = { key: "open" | "computed" | "scrutinized" | "replicated" | "contested"; label: string; rule: string };

/** Public, simple, auditable badge rules. These replace "published in Journal X". */
export const BADGE_RULES: Badge[] = [
  { key: "open", label: "Open", rule: "Has both a data and a code (or notebook) artifact attached." },
  {
    key: "computed",
    label: "Computationally reproduced",
    rule: "The reproducibility bot re-ran the latest version's pinned code in an isolated sandbox, without network access, and every declared result matched the reported value.",
  },
  {
    key: "scrutinized",
    label: "Scrutinized",
    rule: "At least 3 reviews from 3 distinct reviewers, reputation-weighted soundness ≥ 3.5 / 5.",
  },
  { key: "replicated", label: "Replicated", rule: "At least one independent replication reported 'reproduced'." },
  {
    key: "contested",
    label: "Contested",
    rule: "A replication failed, or reputation-weighted soundness is below 2.5 / 5 (min. 2 reviews).",
  },
];

function weightedMean(rows: { v: number; w: number }[]) {
  const W = rows.reduce((s, r) => s + r.w, 0);
  return W ? rows.reduce((s, r) => s + r.v * r.w, 0) / W : null;
}

export function scrutiny(input: ScrutinyInput) {
  const soundness = weightedMean(input.reviews.map((r) => ({ v: r.soundness, w: r.weight })));
  const reproducibility = weightedMean(input.reviews.map((r) => ({ v: r.reproducibility, w: r.weight })));
  const distinctReviewers = new Set(input.reviews.map((r) => r.reviewer_id)).size;
  const reproduced = input.replications.filter((r) => r.outcome === "reproduced").length;
  const failed = input.replications.filter((r) => r.outcome === "failed").length;
  const hasData = input.artifacts.some((a) => a.kind === "data");
  const hasCode = input.artifacts.some((a) => a.kind === "code" || a.kind === "notebook");

  const earned = new Set<Badge["key"]>();
  if (hasData && hasCode) earned.add("open");
  if (input.computational) earned.add("computed");
  if (input.reviews.length >= 3 && distinctReviewers >= 3 && (soundness ?? 0) >= 3.5) earned.add("scrutinized");
  if (reproduced > 0) earned.add("replicated");
  if (failed > 0 || (input.reviews.length >= 2 && soundness !== null && soundness < 2.5)) earned.add("contested");

  return {
    reviewCount: input.reviews.length,
    distinctReviewers,
    soundness,
    reproducibility,
    reproduced,
    failed,
    partial: input.replications.filter((r) => r.outcome === "partial").length,
    endorsements: input.endorsements,
    hasData,
    hasCode,
    versions: input.versions,
    badges: BADGE_RULES.filter((b) => earned.has(b.key)),
  };
}
export type Scrutiny = ReturnType<typeof scrutiny>;
