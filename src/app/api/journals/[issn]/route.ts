import { indexPublic, journalPage } from "@/lib/index/index";
import { normalizeIssn } from "@/lib/index/method";

/** One journal's published assessment with every article measurement, so anyone can recompute the figures. */
export async function GET(_: Request, ctx: RouteContext<"/api/journals/[issn]">) {
  const { issn: raw } = await ctx.params;
  const issn = normalizeIssn(raw);
  const d = issn && indexPublic() ? await journalPage(issn, false) : null;
  if (!d) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    kind: "fjournal.journal-assessment/v1",
    journal: d.journal,
    assessment: d.assessment,
    hash_matches: d.hashOk,
    indicators: d.indicators,
    field_baselines: d.baselines,
    replies: d.replies.map((r) => ({ role: r.role, author: r.display_name, body: r.body, identity_checked_by: r.reviewed_by_handle, how: r.review_note, at: r.reviewed_at })),
    corrections: d.corrections,
    articles: d.articles,
  });
}
