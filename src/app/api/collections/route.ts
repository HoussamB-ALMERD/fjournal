import { listCollections } from "@/lib/collections";
import { publicUrl } from "@/lib/config";

/** Every collection, for indexers, libraries and anyone mirroring Fjournal. */
export async function GET() {
  const base = await publicUrl();
  return Response.json({
    kind: "fjournal.collections/v1",
    items: (await listCollections()).map((c) => ({
      slug: c.slug,
      name: c.name,
      tagline: c.tagline,
      url: `${base}/j/${c.slug}`,
      export: `${base}/api/collections/${c.slug}`,
      continues: c.continues,
      min_reviews: c.min_reviews,
      accepts_submissions: !!c.accepts_submissions,
      board_size: c.board,
      board_orcid_verified: c.verified,
      selected: c.selected,
      under_consideration: c.considering,
      created_at: c.created_at,
    })),
  });
}
