import { feed, type FeedOrigin, type FeedSort } from "@/lib/queries";
import { CONTRIBUTION_TYPES, type ContributionType } from "@/lib/constants";
import { getCollection } from "@/lib/collections";

/** Open, unauthenticated read API — so indexers, libraries and mirrors can harvest everything. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  const slug = sp.get("collection");
  const collection = slug ? await getCollection(slug) : undefined;
  if (slug && !collection) return Response.json({ error: `no collection "${slug}"` }, { status: 404 });
  const items = await feed({
    collection: collection?.id,
    sort: (sp.get("sort") as FeedSort) ?? "latest",
    type: type && type in CONTRIBUTION_TYPES ? (type as ContributionType) : undefined,
    q: sp.get("q") ?? undefined,
    origin: ["fjournal", "imported"].includes(sp.get("origin") ?? "") ? (sp.get("origin") as FeedOrigin) : undefined,
    limit: Number(sp.get("limit")) || 50,
  });
  return Response.json({
    kind: "fjournal.contributions/v1",
    items: items.map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      abstract: i.abstract,
      authors: i.authors,
      license: i.license,
      latest_version: i.latest_version,
      status: i.status,
      replication_of: i.replication_of,
      replication_outcome: i.replication_outcome,
      submitted_by: i.owner_handle,
      imported_by: i.importer_handle,
      source: i.source,
      created_at: i.created_at,
      updated_at: i.updated_at,
      scrutiny: { ...i.scrutiny, badges: i.scrutiny.badges.map((b) => b.key) },
      collections: i.collections.map((c) => c.slug),
    })),
  });
}
