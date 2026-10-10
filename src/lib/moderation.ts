import "server-only";
import { all, get, run, now } from "./db";
import { shortId } from "./ids";
import { reverseReputationFor, restoreReputationFrom } from "./reputation";
import { isAuthorOf } from "./authors";
import {
  MODERATION_REASONS,
  type ModerationAction,
  type ModerationReason,
  type ModerationTarget,
} from "./constants";

/**
 * Moderation exists only for fraud, plagiarism and abuse — never for disagreement.
 * Every action is appended to a public log, explained, attributable to a named moderator,
 * and appealable to a *different* moderator. These rules are enforced here, not just in the UI.
 */

export class ModerationError extends Error {}
const fail = (m: string): never => {
  throw new ModerationError(m);
};

export const isModerator = (u: { id: string } | null) =>
  !!u && get<{ role: string }>("SELECT role FROM users WHERE id = ?", u.id)?.role === "moderator";

const ownsContribution = (userId: string, contributionId: string) => isAuthorOf(userId, contributionId);

type Target = { owner_id: string | null; contribution_id: string; state: "active" | "retracted" | "hidden" };

/** Resolves any moderatable thing to its owner, parent contribution and current state. */
export function resolveTarget(type: ModerationTarget, id: string): Target | undefined {
  if (type === "contribution") {
    // For an imported work, the member who imported it is the one answerable for it (and who may appeal).
    const c = get<{ owner_id: string | null; status: Target["state"] }>(
      "SELECT COALESCE(owner_id, imported_by) AS owner_id, status FROM contributions WHERE id = ?",
      id,
    );
    return c && { owner_id: c.owner_id, contribution_id: id, state: c.status };
  }
  const table = type === "review" ? "reviews" : "comments";
  const owner = type === "review" ? "reviewer_id" : "author_id";
  const r = get<{ owner_id: string; contribution_id: string; hidden: number }>(
    `SELECT ${owner} AS owner_id, contribution_id, hidden FROM ${table} WHERE id = ?`,
    id,
  );
  return r && { owner_id: r.owner_id, contribution_id: r.contribution_id, state: r.hidden ? "hidden" : "active" };
}

function setState(type: ModerationTarget, id: string, state: Target["state"]) {
  if (type === "contribution") run("UPDATE contributions SET status = ? WHERE id = ?", state, id);
  else run(`UPDATE ${type === "review" ? "reviews" : "comments"} SET hidden = ? WHERE id = ?`, state === "active" ? 0 : 1, id);
}

/** Retractions keep the work readable (the record is preserved); hiding is reserved for abuse. */
export function actionFor(type: ModerationTarget, reason: ModerationReason): Exclude<ModerationAction, "restore"> {
  return type === "contribution" ? MODERATION_REASONS[reason].action : "hide";
}

/**
 * Fjournal can't retract what it doesn't publish. Evidence of fraud in an imported work belongs in
 * a public review, where it stays attached to the record; the publisher is the one who must retract.
 */
function refuseRetractingImports(type: ModerationTarget, targetId: string, reason: ModerationReason) {
  if (type !== "contribution" || MODERATION_REASONS[reason].action !== "retract") return;
  if (get("SELECT 1 FROM contributions WHERE id = ? AND source_kind IS NOT NULL", targetId))
    fail(
      "This work was published elsewhere, so Fjournal can't retract it. Post the evidence as a review or in the " +
        "discussion, where it stays attached to the paper for everyone to see, and report it to the publisher.",
    );
}

// ───────────────────────────── Reports ─────────────────────────────

export function fileReport(args: { reporterId: string; type: ModerationTarget; targetId: string; reason: string; details: string }) {
  if (!(args.reason in MODERATION_REASONS))
    fail("That is not a reason for moderation. If you disagree with the work, write a review or a replication.");
  refuseRetractingImports(args.type, args.targetId, args.reason as ModerationReason);
  const t = resolveTarget(args.type, args.targetId) ?? fail("Nothing to report.");
  if (t.owner_id === args.reporterId) fail("You can't report your own content.");
  if (t.state !== "active") fail("This has already been moderated.");
  if (args.details.length < 30) fail("Describe the problem and point to evidence (at least 30 characters).");
  if (
    get("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'",
      args.reporterId, args.type, args.targetId)
  )
    fail("You already have an open report on this.");
  run(
    `INSERT INTO reports (id, target_type, target_id, contribution_id, reporter_id, reason, details, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    `rep_${shortId(10)}`, args.type, args.targetId, t.contribution_id, args.reporterId, args.reason, args.details, now(),
  );
}

export function dismissReport(moderatorId: string, reportId: string, note: string) {
  const r = get<{ status: string }>("SELECT status FROM reports WHERE id = ?", reportId) ?? fail("Report not found.");
  if (r.status !== "open") fail("This report is already resolved.");
  if (note.length < 10) fail("Explain why the report is dismissed.");
  run(
    "UPDATE reports SET status = 'dismissed', resolved_by = ?, resolution_note = ?, resolved_at = ? WHERE id = ?",
    moderatorId, note, now(), reportId,
  );
}

// ───────────────────────────── Actions ─────────────────────────────

/** Must run inside tx(). Returns the public log sequence number. */
export function takeAction(args: {
  moderatorId: string;
  type: ModerationTarget;
  targetId: string;
  reason: string;
  explanation: string;
  evidenceUrl: string;
  reportId?: string;
}): number {
  if (!(args.reason in MODERATION_REASONS)) fail("Not a permitted moderation reason.");
  const reason = args.reason as ModerationReason;
  refuseRetractingImports(args.type, args.targetId, reason);
  const t = resolveTarget(args.type, args.targetId) ?? fail("Target not found.");
  if (t.owner_id === args.moderatorId) fail("Moderators can't act on their own content.");
  // Conflict of interest: a moderator could otherwise hide critical reviews of their own work.
  if (ownsContribution(args.moderatorId, t.contribution_id))
    fail("Moderators can't act on anything attached to their own contributions. Another moderator must handle this.");
  if (t.state !== "active") fail("This has already been moderated.");
  if (args.explanation.length < 30) fail("The public explanation must be at least 30 characters. Say what was found and where.");
  if ((reason === "fabrication" || reason === "plagiarism") && !/^https?:\/\//.test(args.evidenceUrl))
    fail("Fabrication and plagiarism findings require a public evidence link.");

  const action = actionFor(args.type, reason);
  const res = run(
    `INSERT INTO moderation_actions (action, target_type, target_id, contribution_id, reason, explanation, evidence_url, moderator_id, report_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    action, args.type, args.targetId, t.contribution_id, reason, args.explanation, args.evidenceUrl, args.moderatorId, args.reportId ?? null, now(),
  );
  const seq = Number(res.lastInsertRowid);
  setState(args.type, args.targetId, action === "retract" ? "retracted" : "hidden");
  reverseReputationFor(args.targetId, seq);
  // Every open report on the same target is resolved by this action.
  run(
    `UPDATE reports SET status = 'actioned', resolved_by = ?, resolution_note = ?, resolved_at = ?
     WHERE target_type = ? AND target_id = ? AND status = 'open'`,
    args.moderatorId, `See moderation log #${seq}`, now(), args.type, args.targetId,
  );
  return seq;
}

// ───────────────────────────── Appeals ─────────────────────────────

export type ActionRow = {
  seq: number;
  action: ModerationAction;
  target_type: ModerationTarget;
  target_id: string;
  contribution_id: string;
  reason: ModerationReason;
  explanation: string;
  evidence_url: string;
  moderator_id: string;
  moderator_handle: string;
  report_id: string | null;
  reverses_seq: number | null;
  created_at: string;
  title: string;
  reversed_by: number | null;
};

const ACTION_SELECT = `
  SELECT a.*, u.handle AS moderator_handle, v.title,
    (SELECT r.seq FROM moderation_actions r WHERE r.reverses_seq = a.seq) AS reversed_by
  FROM moderation_actions a
  JOIN users u ON u.id = a.moderator_id
  JOIN contributions c ON c.id = a.contribution_id
  JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version`;

export const getAction = (seq: number) => get<ActionRow>(`${ACTION_SELECT} WHERE a.seq = ?`, seq);
export const listActions = (limit = 200) => all<ActionRow>(`${ACTION_SELECT} ORDER BY a.seq DESC LIMIT ?`, limit);
export const actionsForContribution = (id: string) =>
  all<ActionRow>(`${ACTION_SELECT} WHERE a.contribution_id = ? ORDER BY a.seq ASC`, id);

export function fileAppeal(appellantId: string, seq: number, statement: string) {
  const a = getAction(seq) ?? fail("Action not found.");
  if (a.action === "restore") fail("Restorations can't be appealed.");
  if (a.reversed_by) fail("This action was already overturned.");
  const t = resolveTarget(a.target_type, a.target_id)!;
  if (t.owner_id !== appellantId) fail("Only the author of the moderated content can appeal.");
  if (get("SELECT 1 FROM appeals WHERE action_seq = ? AND status = 'open'", seq)) fail("An appeal is already open.");
  if (statement.length < 50) fail("Explain why the decision is wrong (at least 50 characters).");
  run(
    "INSERT INTO appeals (id, action_seq, appellant_id, statement, created_at) VALUES (?,?,?,?,?)",
    `ap_${shortId(10)}`, seq, appellantId, statement, now(),
  );
}

/** Must run inside tx(). An appeal is always decided by a moderator other than the one who acted. */
export function resolveAppeal(moderatorId: string, appealId: string, outcome: "upheld" | "overturned", resolution: string) {
  const ap = get<{ action_seq: number; status: string; appellant_id: string }>(
    "SELECT action_seq, status, appellant_id FROM appeals WHERE id = ?",
    appealId,
  ) ?? fail("Appeal not found.");
  if (ap.status !== "open") fail("This appeal is already resolved.");
  const a = getAction(ap.action_seq)!;
  if (a.moderator_id === moderatorId) fail("An appeal must be decided by a different moderator than the one who acted.");
  if (ap.appellant_id === moderatorId) fail("You can't decide your own appeal.");
  if (ownsContribution(moderatorId, a.contribution_id)) fail("You have a conflict of interest: this concerns your own contribution.");
  if (resolution.length < 30) fail("Explain the decision publicly (at least 30 characters).");

  run("UPDATE appeals SET status = ?, resolver_id = ?, resolution = ?, resolved_at = ? WHERE id = ?", outcome, moderatorId, resolution, now(), appealId);
  if (outcome === "overturned") {
    const res = run(
      `INSERT INTO moderation_actions (action, target_type, target_id, contribution_id, reason, explanation, evidence_url, moderator_id, reverses_seq, created_at)
       VALUES ('restore',?,?,?,?,?,'',?,?,?)`,
      a.target_type, a.target_id, a.contribution_id, a.reason, `Appeal upheld: ${resolution}`, moderatorId, a.seq, now(),
    );
    const restoreSeq = Number(res.lastInsertRowid);
    setState(a.target_type, a.target_id, "active");
    restoreReputationFrom(a.seq, restoreSeq);
  }
}

export function appealsFor(seq: number) {
  return all<{ id: string; statement: string; status: string; resolution: string | null; created_at: string; resolved_at: string | null; appellant_handle: string; resolver_handle: string | null }>(
    `SELECT ap.id, ap.statement, ap.status, ap.resolution, ap.created_at, ap.resolved_at,
       u.handle AS appellant_handle, r.handle AS resolver_handle
     FROM appeals ap JOIN users u ON u.id = ap.appellant_id LEFT JOIN users r ON r.id = ap.resolver_id
     WHERE ap.action_seq = ? ORDER BY ap.created_at ASC`,
    seq,
  );
}

export function openReports() {
  return all<{ id: string; target_type: ModerationTarget; target_id: string; contribution_id: string; reason: ModerationReason; details: string; created_at: string; reporter_handle: string; title: string; excerpt: string | null }>(
    `SELECT r.id, r.target_type, r.target_id, r.contribution_id, r.reason, r.details, r.created_at,
       u.handle AS reporter_handle, v.title,
       CASE r.target_type
         WHEN 'review'  THEN (SELECT substr(body, 1, 400) FROM reviews WHERE id = r.target_id)
         WHEN 'comment' THEN (SELECT substr(body, 1, 400) FROM comments WHERE id = r.target_id)
       END AS excerpt
     FROM reports r JOIN users u ON u.id = r.reporter_id
     JOIN contributions c ON c.id = r.contribution_id
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE r.status = 'open' ORDER BY r.created_at ASC`,
  );
}

export function openAppeals() {
  return all<{ id: string; action_seq: number; statement: string; appellant_handle: string; created_at: string; moderator_id: string }>(
    `SELECT ap.id, ap.action_seq, ap.statement, u.handle AS appellant_handle, ap.created_at, a.moderator_id
     FROM appeals ap JOIN users u ON u.id = ap.appellant_id JOIN moderation_actions a ON a.seq = ap.action_seq
     WHERE ap.status = 'open' ORDER BY ap.created_at ASC`,
  );
}

export function moderationStats() {
  return get<{ actions: number; restores: number; dismissed: number; open_reports: number; open_appeals: number }>(
    `SELECT
       (SELECT COUNT(*) FROM moderation_actions WHERE action <> 'restore') AS actions,
       (SELECT COUNT(*) FROM moderation_actions WHERE action = 'restore') AS restores,
       (SELECT COUNT(*) FROM reports WHERE status = 'dismissed') AS dismissed,
       (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
       (SELECT COUNT(*) FROM appeals WHERE status = 'open') AS open_appeals`,
  )!;
}
