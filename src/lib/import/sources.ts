import "server-only";
import { FetchError, safeFetchBuffer } from "../integrity/safe-fetch";
import { now } from "../db";
import type { ContributionType, SourceKind, SourceRecord } from "../constants";
import { inlineText, jatsToText } from "./text";

/**
 * Metadata lookups for works published elsewhere. Every source here is open and free to query:
 * arXiv, the bioRxiv/medRxiv API, Crossref (journal DOIs) and DataCite (datasets, software, repositories).
 */

const CONTACT = process.env.FJOURNAL_CONTACT_EMAIL;
const HEADERS = {
  "user-agent": `Fjournal/0.1 (open-science review platform${CONTACT ? `; mailto:${CONTACT}` : ""})`,
  accept: "application/json, application/xml;q=0.9, */*;q=0.8",
};

export class ImportError extends Error {}

/** null when the source says the thing doesn't exist; throws on outages, so they aren't mistaken for "not found". */
export async function getText(url: string, maxBytes = 5_000_000, timeoutMs = 20_000): Promise<string | null> {
  try {
    const { buffer } = await safeFetchBuffer(url, maxBytes, timeoutMs, HEADERS);
    return buffer.toString("utf8");
  } catch (e) {
    if (e instanceof FetchError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}

export async function getJson<T>(url: string): Promise<T | null> {
  const t = await getText(url);
  return t === null ? null : (JSON.parse(t) as T);
}

export type FetchedWork = {
  kind: SourceKind;
  sourceId: string;
  type: ContributionType;
  title: string;
  abstract: string;
  authors: string[];
  source: SourceRecord;
};

const MAX_AUTHORS = 100;
function authorList(names: string[]): string[] {
  const clean = names.map((n) => inlineText(n)).filter(Boolean);
  if (clean.length <= MAX_AUTHORS) return clean;
  return [...clean.slice(0, MAX_AUTHORS), `… and ${clean.length - MAX_AUTHORS} more`];
}

/** "Gordon, D. E." → "D. E. Gordon" */
const flipName = (n: string) => {
  const [last, first] = n.split(",").map((x) => x.trim());
  return first ? `${first} ${last}` : n.trim();
};

const finish = (w: Omit<FetchedWork, "title" | "abstract" | "authors"> & { title: string; abstract: string; authors: string[] }): FetchedWork => {
  if (!w.title) throw new ImportError("The source returned no title for this work.");
  return { ...w, title: w.title.slice(0, 500), abstract: w.abstract.slice(0, 10_000), authors: authorList(w.authors) };
};

// ───────────────────────────── arXiv ─────────────────────────────

const tag = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? null;

async function arxivLicense(id: string): Promise<string | null> {
  try {
    const xml = await getText(
      `https://oaipmh.arxiv.org/oai?verb=GetRecord&identifier=oai:arXiv.org:${encodeURIComponent(id)}&metadataPrefix=arXiv`,
    );
    return (xml && tag(xml, "license")?.trim()) || null;
  } catch {
    return null; // the license is nice to have; the import shouldn't fail without it
  }
}

export async function fromArxiv(id: string, version: number | null): Promise<FetchedWork> {
  const q = `${id}${version ? `v${version}` : ""}`;
  const xml = await getText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(q)}&max_results=1`);
  const entry = xml && tag(xml, "entry");
  const m = entry && tag(entry, "id")?.match(/arxiv\.org\/abs\/(.+)v(\d+)$/);
  if (!entry || !m) throw new ImportError(`arXiv has no paper with the identifier "${q}".`);
  const ver = m[2];
  const category = entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
  const journalDoi = tag(entry, "arxiv:doi")?.trim();
  return finish({
    kind: "arxiv",
    sourceId: id,
    type: "research",
    title: inlineText(tag(entry, "title") ?? ""),
    abstract: inlineText(tag(entry, "summary") ?? ""),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => a[1]),
    source: {
      kind: "arxiv",
      id,
      version: ver,
      url: `https://arxiv.org/abs/${id}v${ver}`,
      venue: category ? `arXiv · ${category}` : "arXiv",
      published: tag(entry, "published")?.slice(0, 10) ?? null,
      license_url: await arxivLicense(id),
      links: [
        { label: "PDF", url: `https://arxiv.org/pdf/${id}v${ver}` },
        ...(journalDoi ? [{ label: "Published version", url: `https://doi.org/${journalDoi}` }] : []),
      ],
      notices: [],
      retrieved_at: now(),
    },
  });
}

// ───────────────────────────── bioRxiv / medRxiv ─────────────────────────────

type RxivVersion = {
  title: string; authors: string; doi: string; date: string; version: string; license: string;
  category: string; abstract: string; published: string; server: string; jatsxml?: string;
};

const RXIV_LICENSES: Record<string, string> = {
  cc_by: "https://creativecommons.org/licenses/by/4.0/",
  cc_by_nc: "https://creativecommons.org/licenses/by-nc/4.0/",
  cc_by_nd: "https://creativecommons.org/licenses/by-nd/4.0/",
  cc_by_nc_nd: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  cc0: "https://creativecommons.org/publicdomain/zero/1.0/",
};

export async function rxivVersions(server: "biorxiv" | "medrxiv", doi: string): Promise<RxivVersion[]> {
  const j = await getJson<{ collection?: RxivVersion[] }>(`https://api.biorxiv.org/details/${server}/${doi}`);
  return (j?.collection ?? []).sort((a, b) => Number(a.version) - Number(b.version));
}

/** null when the DOI isn't on either server (10.1101 is also used by Cold Spring Harbor journals). */
export async function fromRxiv(doi: string, version: number | null): Promise<FetchedWork | null> {
  for (const server of ["biorxiv", "medrxiv"] as const) {
    const all = await rxivVersions(server, doi);
    if (all.length === 0) continue;
    const name = server === "biorxiv" ? "bioRxiv" : "medRxiv";
    const v = version ? all.find((x) => Number(x.version) === version) : all.at(-1);
    if (!v) throw new ImportError(`${name} has no version ${version} of ${doi}.`);
    const journal = v.published && v.published !== "NA" ? v.published : null;
    return finish({
      kind: server,
      sourceId: doi,
      type: "research",
      title: inlineText(v.title),
      abstract: inlineText(v.abstract),
      authors: v.authors.split(";").map(flipName),
      source: {
        kind: server,
        id: doi,
        version: v.version,
        url: `https://www.${server}.org/content/${doi}v${v.version}`,
        venue: v.category ? `${name} · ${v.category}` : name,
        published: all[0].date,
        license_url: RXIV_LICENSES[v.license] ?? null,
        links: journal ? [{ label: "Published version", url: `https://doi.org/${journal}` }] : [],
        notices: [],
        retrieved_at: now(),
      },
    });
  }
  return null;
}

// ───────────────────────────── Crossref (journal articles) ─────────────────────────────

type DateParts = { "date-parts"?: (number | null)[][] } | undefined;
const fmtParts = (d: DateParts) => {
  const p = d?.["date-parts"]?.[0]?.filter((x): x is number => typeof x === "number");
  return p?.length ? p.map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0"))).join("-") : null;
};

type CrossrefWork = {
  title?: string[]; subtitle?: string[]; author?: { given?: string; family?: string; name?: string }[];
  abstract?: string; "container-title"?: string[]; publisher?: string; institution?: { name?: string }[];
  published?: DateParts; issued?: DateParts; "published-online"?: DateParts; "published-print"?: DateParts;
  license?: { URL: string; "content-version"?: string; "delay-in-days"?: number }[];
  type?: string; URL?: string;
  "updated-by"?: { DOI: string; type: string; label?: string; updated?: DateParts }[];
};

const doiPath = (doi: string) => encodeURIComponent(doi).replace(/%2F/gi, "/");

export async function fromCrossref(doi: string): Promise<FetchedWork | null> {
  const j = await getJson<{ message: CrossrefWork }>(`https://api.crossref.org/works/${doiPath(doi)}`);
  if (!j) return null;
  const m = j.message;
  const title = [m.title?.[0], m.subtitle?.[0]].filter(Boolean).join(": ");
  const abstract = m.abstract ? jatsToText(m.abstract).replace(/^abstract\s*/i, "").replace(/\s*\n\s*/g, " ") : "";
  const license = m.license?.find((l) => l["content-version"] === "vor") ?? m.license?.[0];
  // Retraction Watch data arrives through Crossref, so retractions show up here even when publishers bury them.
  const seen = new Set<string>();
  const notices = (m["updated-by"] ?? [])
    .filter((u) => !seen.has(u.type + u.DOI) && seen.add(u.type + u.DOI))
    .map((u) => ({ type: u.type, url: `https://doi.org/${u.DOI}`, date: fmtParts(u.updated) }));
  return finish({
    kind: "doi",
    sourceId: doi,
    type: m.type === "dataset" ? "dataset" : "research",
    title: inlineText(title),
    abstract: inlineText(abstract),
    authors: (m.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")),
    source: {
      kind: "doi",
      id: doi,
      version: null,
      url: m.URL ?? `https://doi.org/${doi}`,
      venue: inlineText(m["container-title"]?.[0] ?? m.institution?.[0]?.name ?? m.publisher ?? ""),
      published: fmtParts(m.published ?? m.issued ?? m["published-online"] ?? m["published-print"]),
      license_url: license?.URL ?? null,
      links: [],
      notices,
      retrieved_at: now(),
    },
  });
}

// ───────────────────────────── DataCite (datasets, software, repositories) ─────────────────────────────

type DataCiteWork = {
  titles?: { title: string }[]; creators?: { name: string }[];
  descriptions?: { description: string; descriptionType?: string }[];
  publisher?: string | { name?: string }; publicationYear?: number | string;
  rightsList?: { rightsUri?: string }[]; types?: { resourceTypeGeneral?: string }; url?: string;
};

export async function fromDataCite(doi: string): Promise<FetchedWork | null> {
  const j = await getJson<{ data: { attributes: DataCiteWork } }>(`https://api.datacite.org/dois/${doiPath(doi)}`);
  if (!j) return null;
  const a = j.data.attributes;
  const general = a.types?.resourceTypeGeneral;
  const publisher = typeof a.publisher === "string" ? a.publisher : a.publisher?.name ?? "";
  return finish({
    kind: "doi",
    sourceId: doi,
    type: general === "Dataset" ? "dataset" : general === "Software" ? "software" : "research",
    title: inlineText(a.titles?.[0]?.title ?? ""),
    abstract: inlineText((a.descriptions?.find((d) => d.descriptionType === "Abstract") ?? a.descriptions?.[0])?.description ?? ""),
    authors: (a.creators ?? []).map((c) => flipName(c.name)),
    source: {
      kind: "doi",
      id: doi,
      version: null,
      url: `https://doi.org/${doi}`,
      venue: inlineText(publisher),
      published: a.publicationYear ? String(a.publicationYear) : null,
      license_url: a.rightsList?.find((r) => r.rightsUri)?.rightsUri ?? null,
      links: a.url ? [{ label: "Repository page", url: a.url }] : [],
      notices: [],
      retrieved_at: now(),
    },
  });
}

/** Resolves a DOI through every source that might know it, most specific first. */
export async function fromDoi(doi: string, version: number | null): Promise<FetchedWork> {
  const work =
    (doi.startsWith("10.1101/") ? await fromRxiv(doi, version) : null) ?? (await fromCrossref(doi)) ?? (await fromDataCite(doi));
  if (!work) throw new ImportError(`No record found for DOI ${doi} at Crossref, DataCite, bioRxiv or medRxiv.`);
  return work;
}
