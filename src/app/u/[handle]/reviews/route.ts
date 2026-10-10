import { publicUrl } from "@/lib/config";
import { bibtex, citationInput, cslJson, ris } from "@/lib/citation";
import { getReview, getUserByHandle, reviewsBy } from "@/lib/queries";

/** A reviewer's whole public record, ready for a CV or a reference manager. ?format=bibtex (default) | ris | csl */
export async function GET(req: Request, ctx: RouteContext<"/u/[handle]/reviews">) {
  const { handle } = await ctx.params;
  const u = await getUserByHandle(handle);
  if (!u) return Response.json({ error: "not found" }, { status: 404 });
  const site = await publicUrl();
  const inputs = await Promise.all((await reviewsBy(u.id)).map(async (x) => citationInput((await getReview(x.id))!, x.title, site)));
  const format = new URL(req.url).searchParams.get("format") ?? "bibtex";
  const file = `fjournal-reviews-${u.handle}`;
  if (format === "csl") return Response.json(inputs.map(cslJson));
  if (format === "ris")
    return new Response(inputs.map(ris).join(""), {
      headers: { "content-type": "application/x-research-info-systems; charset=utf-8", "content-disposition": `attachment; filename="${file}.ris"` },
    });
  return new Response(inputs.map(bibtex).join("\n"), {
    headers: { "content-type": "application/x-bibtex; charset=utf-8", "content-disposition": `inline; filename="${file}.bib"` },
  });
}
