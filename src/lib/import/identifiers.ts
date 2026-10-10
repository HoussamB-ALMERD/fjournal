/** Parses whatever a person pastes — an ID, a DOI or a link — into something we can look up. Pure. */

export type Identifier =
  | { kind: "arxiv"; id: string; version: number | null }
  | { kind: "doi"; doi: string; version: number | null }; // version: only from bioRxiv/medRxiv links

const ARXIV = /^((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}))(?:v(\d+))?$/i;
const DOI = /^10\.\d{4,9}\/\S+$/;
// bioRxiv/medRxiv DOIs: 10.1101/2020.03.22.002386 (or the older 10.1101/123456), optionally followed by v2.
const RXIV = /(10\.1101\/(?:\d{4}\.\d{2}\.\d{2}\.)?\d{6,})(?:v(\d+))?/;

function arxiv(raw: string): Identifier | null {
  const m = raw.trim().match(ARXIV);
  if (!m) return null;
  // Old-style IDs keep the archive's case ("math.GT/0309136"); only the archive name is lower-case.
  const id = m[1].includes("/") ? m[1].replace(/^[a-z-]+/i, (a) => a.toLowerCase()) : m[1];
  return { kind: "arxiv", id, version: m[2] ? Number(m[2]) : null };
}

export function normalizeDoi(raw: string): string | null {
  const d = raw.trim().replace(/[.,;]+$/, "").toLowerCase();
  return DOI.test(d) ? d : null;
}

function doi(raw: string, version: number | null = null): Identifier | null {
  const d = normalizeDoi(raw);
  if (!d) return null;
  // arXiv's own DOIs (10.48550/arXiv.2301.00001) are better served by the arXiv API.
  const ax = d.match(/^10\.48550\/arxiv\.(.+)$/);
  if (ax) return arxiv(ax[1]);
  return { kind: "doi", doi: d, version };
}

export function parseIdentifier(input: string): Identifier | null {
  let s = input.trim().replace(/^<|>$/g, "");
  if (!s || s.length > 500) return null;
  try {
    s = decodeURIComponent(s);
  } catch {}

  if (/^https?:\/\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/^(www|export)\./, "");
    if (host === "arxiv.org" || host === "alphaxiv.org") {
      const m = url.pathname.match(/^\/(?:abs|pdf|html|overview)\/(.+?)(?:\.pdf)?\/?$/);
      return m ? arxiv(m[1]) : null;
    }
    if (host === "doi.org" || host === "dx.doi.org") return doi(url.pathname.slice(1));
    if (host === "biorxiv.org" || host === "medrxiv.org") {
      const m = url.pathname.match(RXIV);
      return m ? doi(m[1], m[2] ? Number(m[2]) : null) : null;
    }
    // Most publisher URLs embed the DOI somewhere in the path.
    const m = url.pathname.match(/10\.\d{4,9}\/[^?#\s]+/);
    return m ? doi(m[0].replace(/\/(full|abstract|pdf|epdf|html)\/?$/i, "")) : null;
  }

  const prefixed = s.match(/^(arxiv|doi)\s*:\s*(.+)$/i);
  if (prefixed) return prefixed[1].toLowerCase() === "arxiv" ? arxiv(prefixed[2]) : doi(prefixed[2]);
  const rx = s.match(new RegExp(`^${RXIV.source}$`));
  if (rx) return doi(rx[1], rx[2] ? Number(rx[2]) : null);
  return doi(s) ?? arxiv(s);
}
