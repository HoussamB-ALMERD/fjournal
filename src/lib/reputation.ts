import "server-only";
import { all, get, run, now } from "./db";

/**
 * Reputation is an append-only ledger. Rules are public (see /about#reputation)
 * and deliberately simple so anyone can audit them.
 */
export const POINTS = {
  contribution: 10,
  negative_result: 10, // equal to a positive result, on purpose
  replication_published: 15,
  replicated_by_others: 20,
  review_helpful: 5,
  endorsement_received: 3,
} as const;

export type RepKind = keyof typeof POINTS;

export function reputationOf(userId: string): number {
  return get<{ s: number | null }>("SELECT SUM(points) AS s FROM reputation_events WHERE user_id = ?", userId)?.s ?? 0;
}

/** Logarithmic: established members count more, newcomers still count, no oligarchy. */
export function weightOf(userId: string): number {
  return 1 + Math.log10(1 + Math.max(0, reputationOf(userId)));
}

export function award(userId: string, kind: RepKind, ref: string, multiplier = 1) {
  run(
    "INSERT INTO reputation_events (user_id, kind, points, ref, created_at) VALUES (?,?,?,?,?)",
    userId,
    kind,
    Math.round(POINTS[kind] * multiplier * 100) / 100,
    ref,
    now(),
  );
}

export function reputationBreakdown(userId: string) {
  return all<{ kind: RepKind | "moderation_reversal" | "moderation_restored"; n: number; points: number }>(
    `SELECT kind, COUNT(*) AS n, ROUND(SUM(points), 1) AS points
     FROM reputation_events WHERE user_id = ? GROUP BY kind ORDER BY points DESC`,
    userId,
  );
}

/**
 * Moderation never deletes reputation history. Retracting or hiding content appends an
 * offsetting event; overturning that on appeal appends the inverse. The ledger tells the whole story.
 */
export function reverseReputationFor(targetId: string, modSeq: number) {
  const sums = all<{ user_id: string; points: number }>(
    `SELECT user_id, SUM(points) AS points FROM reputation_events
     WHERE (ref = ? OR substr(ref, 1, length(?) + 1) = ? || ':')
       AND kind NOT IN ('moderation_reversal','moderation_restored')
     GROUP BY user_id HAVING SUM(points) <> 0`,
    targetId,
    targetId,
    targetId,
  );
  for (const s of sums)
    run(
      "INSERT INTO reputation_events (user_id, kind, points, ref, created_at) VALUES (?,?,?,?,?)",
      s.user_id, "moderation_reversal", -s.points, `mod:${modSeq}`, now(),
    );
}

export function restoreReputationFrom(reversedSeq: number, restoreSeq: number) {
  const rows = all<{ user_id: string; points: number }>(
    "SELECT user_id, points FROM reputation_events WHERE ref = ? AND kind = 'moderation_reversal'",
    `mod:${reversedSeq}`,
  );
  for (const r of rows)
    run(
      "INSERT INTO reputation_events (user_id, kind, points, ref, created_at) VALUES (?,?,?,?,?)",
      r.user_id, "moderation_restored", -r.points, `mod:${restoreSeq}`, now(),
    );
}
