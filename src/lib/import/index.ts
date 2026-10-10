import "server-only";
import { get, run, tx, now } from "../db";
import { contributionId } from "../ids";
import { appendVersion, type VersionContent } from "../ledger";
import { SOURCE_KINDS } from "../constants";
import { parseIdentifier } from "./identifiers";
import { ImportError, fromArxiv, fromDoi, type FetchedWork } from "./sources";

export { ImportError };

/**
 * Brings a work published anywhere else onto Fjournal as a reviewable record. Nobody becomes its
 * owner: the authors aren't members, the person importing it gets no credit for authorship, and
 * nobody can edit it. Its metadata snapshot goes into the ledger like any other version, so reviews
 * always point at exactly what was reviewed.
 */

export type ImportResult = { id: string; seq: number | null; status: "created" | "updated" | "unchanged" };

const HOURLY_LIMIT = 30;

const toContent = (w: FetchedWork): VersionContent => ({
  title: w.title,
  abstract: w.abstract,
  body: "", // the full text stays at the source; Fjournal hosts the review, not the paper
  authors: w.authors.length ? w.authors : ["(authors not listed by the source)"],
  license: "EXTERNAL",
  artifacts: [],
  source: w.source,
});

type Existing = { id: string; latest_version: number; source: string | null };
const existingFor = (sourceId: string) =>
  get<Existing>(
    `SELECT c.id, c.latest_version, v.source FROM contributions c
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE c.source_id = ?`,
    sourceId,
  );

const sourceVersion = (e: Existing) => Number((e.source && JSON.parse(e.source).version) ?? 0);

export async function importWork(input: string, importerId: string): Promise<ImportResult> {
  const ident = parseIdentifier(input);
  if (!ident) throw new ImportError("Paste an arXiv ID, a DOI, or a link to arXiv, bioRxiv, medRxiv, doi.org or a publisher page.");
  const sourceId = ident.kind === "arxiv" ? ident.id : ident.doi;

  // Already here, and nothing newer was asked for: no need to touch the network.
  const before = await existingFor(sourceId);
  if (before) {
    const versioned = JSON.parse(before.source ?? "{}").version != null;
    if (!versioned || (ident.version !== null && ident.version <= sourceVersion(before)))
      return { id: before.id, seq: null, status: "unchanged" };
  } else {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM contributions WHERE imported_by = ? AND created_at > ?", importerId, since))!.n;
    if (recent >= HOURLY_LIMIT) throw new ImportError(`You can import up to ${HOURLY_LIMIT} works per hour. Try again a little later.`);
  }

  const work = ident.kind === "arxiv" ? await fromArxiv(ident.id, ident.version) : await fromDoi(ident.doi, ident.version);
  const content = toContent(work);
  const label = work.kind === "doi" ? work.source.venue || "the publisher" : SOURCE_KINDS[work.kind];

  return tx(async () => {
    const ts = now();
    // Re-read under the write lock: two people may import the same paper at the same moment.
    const e = await existingFor(work.sourceId);
    if (!e) {
      const id = contributionId();
      await run(
        `INSERT INTO contributions (id, type, owner_id, latest_version, created_at, updated_at, source_kind, source_id, imported_by)
         VALUES (?,?,NULL,1,?,?,?,?,?)`,
        id, work.type, ts, ts, work.kind, work.sourceId, importerId,
      );
      const v = await appendVersion({
        contributionId: id, number: 1, content, createdBy: importerId, createdAt: ts,
        changeNote: `Imported from ${label}${work.source.version ? ` (v${work.source.version})` : ""}`,
      });
      return { id, seq: v.seq, status: "created" as const };
    }
    // Preprint servers version their papers; a newer version at the source becomes a new version here.
    if (work.source.version === null || Number(work.source.version) <= sourceVersion(e))
      return { id: e.id, seq: null, status: "unchanged" as const };
    const number = e.latest_version + 1;
    const v = await appendVersion({
      contributionId: e.id, number, content, createdBy: importerId, createdAt: ts,
      changeNote: `New version at ${label}: v${work.source.version}`,
    });
    await run("UPDATE contributions SET latest_version = ?, updated_at = ? WHERE id = ?", number, ts, e.id);
    return { id: e.id, seq: v.seq, status: "updated" as const };
  });
}
