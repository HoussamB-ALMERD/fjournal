import { getContribution, getVersion } from "@/lib/queries";

/** A self-contained, downloadable proof that this exact content existed at this time in the ledger. */
export async function GET(req: Request, ctx: RouteContext<"/c/[id]/v/[n]/receipt">) {
  const { id, n } = await ctx.params;
  const c = await getContribution(id);
  const v = c && (await getVersion(id, Number(n)));
  if (!c || !v) return Response.json({ error: "not found" }, { status: 404 });

  const origin = new URL(req.url).origin;
  const receipt = {
    kind: "fjournal.priority-receipt/v1",
    contribution: c.id,
    version: v.number,
    url: `${origin}/c/${c.id}?v=${v.number}`,
    timestamp: v.created_at,
    ledger: { seq: v.seq, prev_chain_hash: v.prev_chain_hash, chain_hash: v.chain_hash },
    content_hash: v.content_hash,
    content: {
      title: v.title,
      abstract: v.abstract,
      body: v.body,
      authors: v.authors,
      license: v.license,
      artifacts: v.artifacts,
      // Only present on versions that carry declarations; absent keys are not hashed.
      ...(v.declarations ? { declarations: v.declarations } : {}),
      ...(v.source ? { source: v.source } : {}),
    },
    verify:
      "content_hash = sha256(canonical_json(content)) with keys sorted recursively; " +
      "chain_hash = sha256(prev_chain_hash|content_hash|contribution|version|timestamp). " +
      `Compare chain_hash against ${origin}/api/ledger or any mirror of it.`,
  };
  return new Response(JSON.stringify(receipt, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="fjournal-${c.id}-v${v.number}-receipt.json"`,
    },
  });
}
