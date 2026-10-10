import { publicUrl } from "@/lib/config";
import { bibtex, citationInput, cslJson, ris } from "@/lib/citation";
import { getContribution, getReview, getVersion } from "@/lib/queries";

/** ?format=bibtex (default) | ris | csl */
export async function GET(req: Request, ctx: RouteContext<"/r/[id]/cite">) {
  const { id } = await ctx.params;
  const r = getReview(id);
  const c = r && getContribution(r.contribution_id);
  const v = r && c && getVersion(c.id, r.version_number);
  if (!r || !c || !v || r.hidden || c.status === "hidden") return Response.json({ error: "not found" }, { status: 404 });
  const input = citationInput(r, v.title, await publicUrl());
  const format = new URL(req.url).searchParams.get("format") ?? "bibtex";
  const file = `fjournal-review-${r.id}`;
  if (format === "csl") return Response.json([cslJson(input)], { headers: { "content-disposition": `inline; filename="${file}.json"` } });
  if (format === "ris")
    return new Response(ris(input), {
      headers: { "content-type": "application/x-research-info-systems; charset=utf-8", "content-disposition": `attachment; filename="${file}.ris"` },
    });
  return new Response(bibtex(input), {
    headers: { "content-type": "application/x-bibtex; charset=utf-8", "content-disposition": `inline; filename="${file}.bib"` },
  });
}
