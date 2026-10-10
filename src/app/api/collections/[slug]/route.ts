import { all } from "@/lib/db";
import { publicUrl } from "@/lib/config";
import { boardOf, getCollection, itemsOf, policyHash } from "@/lib/collections";
import { verifyLedger } from "@/lib/ledger";

/**
 * A whole collection: settings, board, every decision and the raw hash-chained log. Enough for a board
 * to leave Fjournal with its record intact, and for anyone to verify it independently.
 */
export async function GET(_: Request, ctx: RouteContext<"/api/collections/[slug]">) {
  const { slug } = await ctx.params;
  const c = await getCollection(slug);
  if (!c) return Response.json({ error: "not found" }, { status: 404 });
  const base = await publicUrl();
  const items = await itemsOf(c.id, ["submitted", "selected", "declined", "withdrawn", "removed"]);
  // Raw entries: content_hash = sha256(canonical JSON of {collection_id, kind, actor_id, subject, payload, created_at});
  // chain_hash = sha256("collection|" + prev_chain_hash + "|" + content_hash + "|" + created_at). One chain across all collections.
  const log = (await all<{ seq: number; kind: string; actor_id: string; actor_handle: string; subject: string | null; payload: string; content_hash: string; prev_chain_hash: string; chain_hash: string; created_at: string }>(
    `SELECT l.seq, l.kind, l.actor_id, u.handle AS actor_handle, l.subject, l.payload, l.content_hash, l.prev_chain_hash, l.chain_hash, l.created_at
     FROM collection_log l JOIN users u ON u.id = l.actor_id WHERE l.collection_id = ? ORDER BY l.seq ASC`,
    c.id,
  )).map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  const [board, verification] = await Promise.all([boardOf(c.id), verifyLedger()]);

  return Response.json({
    kind: "fjournal.collection/v1",
    id: c.id,
    slug: c.slug,
    url: `${base}/j/${c.slug}`,
    name: c.name,
    tagline: c.tagline,
    scope: c.scope,
    policy: c.policy,
    policy_hash: policyHash(c),
    min_reviews: c.min_reviews,
    accepts_submissions: !!c.accepts_submissions,
    accent: c.accent,
    continues: c.continues,
    created_at: c.created_at,
    updated_at: c.updated_at,
    board: board.map((m) => ({ handle: m.handle, name: m.display_name, role: m.role, orcid_verified: m.orcid, since: m.since })),
    items: items.map((i) => ({
      contribution_id: i.contribution_id,
      url: `${base}/c/${i.contribution_id}`,
      title: i.title,
      status: i.status,
      version: i.version_number,
      latest_version: i.latest_version,
      nominated: !!i.nominated,
      decided_by: i.decided_by_handle,
      decided_at: i.decided_at,
      decision_note: i.decision_note,
      log_seq: i.log_seq,
    })),
    verification: verification.collections,
    log,
  });
}
