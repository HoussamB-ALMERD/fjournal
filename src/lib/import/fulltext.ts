import "server-only";
import type { SourceRecord } from "../constants";
import { getJson, getText, rxivVersions } from "./sources";
import { htmlToText, jatsToText } from "./text";

/**
 * Finds a machine-readable open copy of an imported work so the automated checks can read the
 * whole paper, not just its abstract. The text is analysed in memory and never stored or republished.
 */

export type FullText = { text: string; from: string; url: string };

const MAX_BYTES = 15_000_000;
const fetchDoc = (url: string) => getText(url, MAX_BYTES, 30_000);

/** One failing candidate (a 500 from a mirror, say) shouldn't stop us trying the next. */
async function firstOf(candidates: (() => Promise<FullText | null>)[]): Promise<FullText | null> {
  let lastError: unknown = null;
  for (const c of candidates) {
    try {
      const r = await c();
      if (r && r.text.length > 500) return r;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function europePmc(doi: string): Promise<FullText | null> {
  const q = encodeURIComponent(`DOI:"${doi}"`);
  const j = await getJson<{ resultList?: { result?: { id: string; source: string; pmcid?: string }[] } }>(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&resultType=lite&format=json`,
  );
  const r = j?.resultList?.result?.[0];
  if (!r) return null;
  const ids = [r.pmcid, r.source === "PPR" ? r.id : undefined].filter((x): x is string => !!x);
  return firstOf(
    ids.map((id) => async () => {
      const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/fullTextXML`;
      const xml = await fetchDoc(url);
      return xml ? { text: jatsToText(xml), from: `Europe PMC (${id})`, url } : null;
    }),
  );
}

export async function fetchOpenFullText(s: SourceRecord): Promise<FullText | null> {
  if (s.kind === "arxiv") {
    // arXiv renders most papers since late 2023 as HTML; older ones are PDF-only.
    const url = `https://arxiv.org/html/${s.id}${s.version ? `v${s.version}` : ""}`;
    const html = await fetchDoc(url);
    return html && !/<title>[^<]*(No HTML|not found)/i.test(html) ? { text: htmlToText(html), from: "arXiv HTML", url } : null;
  }
  const candidates: (() => Promise<FullText | null>)[] = [];
  if (s.kind === "biorxiv" || s.kind === "medrxiv") {
    const kind = s.kind;
    candidates.push(async () => {
      const v = (await rxivVersions(kind, s.id)).find((x) => x.version === s.version);
      if (!v?.jatsxml) return null;
      const xml = await fetchDoc(v.jatsxml);
      return xml ? { text: jatsToText(xml), from: `${kind === "biorxiv" ? "bioRxiv" : "medRxiv"} JATS XML`, url: v.jatsxml } : null;
    });
  }
  candidates.push(() => europePmc(s.id));
  return firstOf(candidates);
}
