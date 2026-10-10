/** Citation formats for reviews, so they can go in a CV, a reference manager or a funder report. Pure. */
import type { ReviewRow } from "./queries";

export type ReviewCitationInput = {
  id: string;
  reviewer_name: string;
  reviewer_orcid: string | null; // only verified iDs
  created_at: string;
  title: string; // the reviewed work
  contribution_id: string;
  version_number: number;
  doi: string | null; // only once registered
  url: string;
  content_hash: string | null;
};

const year = (iso: string) => iso.slice(0, 4);
const reviewTitle = (c: ReviewCitationInput) => `Review of "${c.title}" (version ${c.version_number})`;
const bibEscape = (s: string) => s.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");

export function plainCitation(c: ReviewCitationInput): string {
  const where = c.doi ? `https://doi.org/${c.doi}` : c.url;
  return `${c.reviewer_name} (${year(c.created_at)}). ${reviewTitle(c)}. Fjournal open peer review. ${where}`;
}

export function bibtex(c: ReviewCitationInput): string {
  const fields: [string, string][] = [
    ["author", `{${bibEscape(c.reviewer_name)}}`],
    ["title", `{${bibEscape(reviewTitle(c))}}`],
    ["year", year(c.created_at)],
    ["publisher", "Fjournal"],
    ["howpublished", "Open peer review"],
    ...(c.doi ? ([["doi", bibEscape(c.doi)]] as [string, string][]) : []),
    ["url", c.doi ? `https://doi.org/${c.doi}` : c.url],
    ["note", bibEscape(`Review of fj:${c.contribution_id} v${c.version_number}${c.content_hash ? `; sha256:${c.content_hash}` : ""}`)],
  ];
  return `@misc{fjournal_${c.id},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}\n`;
}

export function ris(c: ReviewCitationInput): string {
  const lines = [
    "TY  - GEN",
    `AU  - ${c.reviewer_name}`,
    `TI  - ${reviewTitle(c)}`,
    `PY  - ${year(c.created_at)}`,
    `DA  - ${c.created_at.slice(0, 10).replace(/-/g, "/")}`,
    "PB  - Fjournal",
    "M3  - Open peer review",
    ...(c.doi ? [`DO  - ${c.doi}`] : []),
    `UR  - ${c.doi ? `https://doi.org/${c.doi}` : c.url}`,
    "ER  - ",
  ];
  return lines.join("\r\n") + "\r\n";
}

export function cslJson(c: ReviewCitationInput) {
  return {
    id: `fjournal_${c.id}`,
    type: "review",
    title: reviewTitle(c),
    "reviewed-title": c.title,
    author: [{ literal: c.reviewer_name, ...(c.reviewer_orcid ? { ORCID: `https://orcid.org/${c.reviewer_orcid}` } : {}) }],
    issued: { "date-parts": [c.created_at.slice(0, 10).split("-").map(Number)] },
    publisher: "Fjournal",
    genre: "Open peer review",
    ...(c.doi ? { DOI: c.doi } : {}),
    URL: c.doi ? `https://doi.org/${c.doi}` : c.url,
  };
}

export function citationInput(r: ReviewRow, title: string, site: string): ReviewCitationInput {
  return {
    id: r.id,
    reviewer_name: r.reviewer_name,
    reviewer_orcid: r.reviewer_orcid,
    created_at: r.created_at,
    title,
    contribution_id: r.contribution_id,
    version_number: r.version_number,
    doi: r.doi_status === "registered" ? r.doi : null, // a DOI is cited only once it resolves
    url: `${site}/r/${r.id}`,
    content_hash: r.ledger_hash,
  };
}
