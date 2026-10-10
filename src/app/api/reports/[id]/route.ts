import { frozenReport } from "@/lib/report";

/** A frozen report, exactly as stored: recompute sha256(canonical JSON of `data`) and compare with `content_hash`. */
export async function GET(_: Request, ctx: RouteContext<"/api/reports/[id]">) {
  const { id } = await ctx.params;
  const r = frozenReport(id);
  if (!r) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    kind: "fjournal.frozen-report/v1",
    id: r.id,
    frozen_at: r.created_at,
    frozen_by: r.requested_by_handle,
    content_hash: r.content_hash,
    hash_matches: r.intact,
    data: r.data,
  });
}
