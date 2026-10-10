import "server-only";
import { all, get, run, now } from "./db";
import { orcidWorkIds } from "./orcid";

/**
 * Who counts as an author of a work on Fjournal: the member who published it here, or a member who
 * proved through their own ORCID record that they wrote an imported work. Authors can respond to
 * reviews, but they can't review, endorse or "independently" replicate their own work.
 */

export class ClaimError extends Error {}

export function isAuthorOf(userId: string, contributionId: string): boolean {
  return !!get(
    `SELECT 1 FROM contributions WHERE id = ? AND owner_id = ?
     UNION ALL SELECT 1 FROM contribution_authors WHERE contribution_id = ? AND user_id = ?`,
    contributionId, userId, contributionId, userId,
  );
}

export function verifiedAuthors(contributionId: string) {
  return all<{ user_id: string; handle: string; display_name: string; orcid: string; created_at: string }>(
    `SELECT a.user_id, u.handle, u.display_name, a.orcid, a.created_at
     FROM contribution_authors a JOIN users u ON u.id = a.user_id
     WHERE a.contribution_id = ? ORDER BY a.created_at ASC`,
    contributionId,
  );
}

/** Verifies an authorship claim against the claimant's public ORCID record. Nothing is taken on trust. */
export async function claimAuthorship(userId: string, contributionId: string) {
  const u = get<{ orcid: string | null; orcid_verified_at: string | null }>("SELECT orcid, orcid_verified_at FROM users WHERE id = ?", userId);
  if (!u?.orcid || !u.orcid_verified_at) throw new ClaimError("Connect your ORCID iD first (Settings → Connect ORCID).");
  const c = get<{ source_kind: string | null; source_id: string | null; status: string }>(
    "SELECT source_kind, source_id, status FROM contributions WHERE id = ?",
    contributionId,
  );
  if (!c || c.status === "hidden") throw new ClaimError("Contribution not found.");
  if (!c.source_id) throw new ClaimError("Only works imported from elsewhere can be claimed. Work published here already has its author.");
  if (get("SELECT 1 FROM contribution_authors WHERE contribution_id = ? AND user_id = ?", contributionId, userId))
    throw new ClaimError("You're already a verified author of this work.");
  if (get("SELECT 1 FROM reviews WHERE contribution_id = ? AND reviewer_id = ? AND hidden = 0", contributionId, userId))
    throw new ClaimError("You've reviewed this work, so you can't also claim to be its author. If that's a mistake, contact a moderator.");

  const key = c.source_kind === "arxiv" ? `arxiv:${c.source_id.toLowerCase()}` : `doi:${c.source_id}`;
  const listed = await orcidWorkIds(u.orcid);
  // A preprint is also matched by the DOI arXiv assigns it.
  const alt = c.source_kind === "arxiv" ? `doi:10.48550/arxiv.${c.source_id.toLowerCase()}` : null;
  if (!listed.has(key) && !(alt && listed.has(alt)))
    throw new ClaimError(
      `Your public ORCID record (${u.orcid}) doesn't list ${c.source_kind === "arxiv" ? `arXiv:${c.source_id}` : `DOI ${c.source_id}`}. ` +
        "Add the work to your ORCID record (and make it public), then try again.",
    );
  run(
    "INSERT INTO contribution_authors (contribution_id, user_id, orcid, verified_via, created_at) VALUES (?,?,?,?,?)",
    contributionId, userId, u.orcid, "orcid-works", now(),
  );
}
