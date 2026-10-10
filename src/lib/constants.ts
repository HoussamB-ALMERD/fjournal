export const CONTRIBUTION_TYPES = {
  research: { label: "Research", hint: "Original findings" },
  replication: { label: "Replication", hint: "An attempt to reproduce another contribution" },
  negative_result: { label: "Negative result", hint: "It didn't work — and that is knowledge" },
  incremental: { label: "Incremental improvement", hint: "A careful step forward on existing work" },
  method: { label: "Method", hint: "A protocol, technique or analysis method" },
  dataset: { label: "Dataset", hint: "Data as the primary contribution" },
  software: { label: "Software", hint: "Code as the primary contribution" },
  review_article: { label: "Review article", hint: "Synthesis of a field" },
} as const;
export type ContributionType = keyof typeof CONTRIBUTION_TYPES;

export const LICENSES = {
  "CC-BY-4.0": {
    label: "CC BY 4.0",
    summary: "Anyone may reuse with attribution. Recommended — maximises reach and citation.",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  "CC-BY-SA-4.0": {
    label: "CC BY-SA 4.0",
    summary: "Reuse with attribution; derivatives must use the same license.",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  "CC-BY-NC-4.0": {
    label: "CC BY-NC 4.0",
    summary: "Reuse with attribution, non-commercial only.",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
  "CC0-1.0": {
    label: "CC0 (public domain)",
    summary: "No rights reserved. Anyone may use for any purpose.",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  ARR: {
    label: "All Rights Reserved",
    summary: "You keep every right. Readers may read it here; reuse requires your permission.",
    url: null,
  },
  // Never offered to authors: marks imported records, whose license is whatever the source says.
  EXTERNAL: {
    label: "Source license",
    summary: "Imported record. The license set at the original source applies.",
    url: null,
  },
} as const;
export type License = keyof typeof LICENSES;
export const DEFAULT_LICENSE: License = "CC-BY-4.0";
/** The licenses an author can choose from. */
export const AUTHOR_LICENSES: License[] = (Object.keys(LICENSES) as License[]).filter((l) => l !== "EXTERNAL");

/** Turns a Creative Commons URL into "CC BY-NC 4.0"; anything else is the publisher's own terms. */
export function licenseLabelFromUrl(url: string | null): string {
  if (!url) return "License: see source";
  if (/creativecommons\.org\/publicdomain\/zero/i.test(url)) return "CC0";
  const m = url.match(/creativecommons\.org\/licenses\/([a-z-]+)\/(\d\.\d)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  if (/arxiv\.org\/licenses\/nonexclusive/i.test(url)) return "arXiv non-exclusive license";
  return "Publisher license";
}

export const ARTIFACT_KINDS = ["data", "code", "notebook", "protocol", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const RECOMMENDATIONS = {
  sound: "Sound",
  minor_issues: "Minor issues",
  major_issues: "Major issues",
  unsound: "Unsound",
} as const;
export type Recommendation = keyof typeof RECOMMENDATIONS;

export const REPLICATION_OUTCOMES = {
  reproduced: "Reproduced",
  partial: "Partially reproduced",
  failed: "Failed to reproduce",
} as const;
export type ReplicationOutcome = keyof typeof REPLICATION_OUTCOMES;

export const RUBRIC = ["soundness", "reproducibility", "clarity", "significance"] as const;
export type RubricKey = (typeof RUBRIC)[number];

/**
 * The ONLY reasons content can be moderated. Disagreement, "low quality", "wrong conclusions" or
 * going against consensus are deliberately absent: those are answered with reviews and
 * replications, never with removal.
 */
export const MODERATION_REASONS = {
  fabrication: {
    label: "Fabrication or falsification",
    action: "retract",
    hint: "Data or results that were invented or manipulated. Requires concrete evidence.",
  },
  plagiarism: {
    label: "Plagiarism",
    action: "retract",
    hint: "Substantial copying of someone else's work without attribution.",
  },
  spam: { label: "Spam", action: "hide", hint: "Advertising or content that is not a scholarly contribution." },
  harassment: { label: "Harassment or abuse", action: "hide", hint: "Personal attacks, threats or hate speech." },
  privacy: { label: "Exposes private data", action: "hide", hint: "Personal data about people who did not consent." },
  illegal: { label: "Unlawful content", action: "hide", hint: "Content we are legally required to remove." },
} as const;
export type ModerationReason = keyof typeof MODERATION_REASONS;
export type ModerationAction = "retract" | "hide" | "restore";
export type ModerationTarget = "contribution" | "review" | "comment";

export type Funding = { funder: string; grant: string };
/** Part of each version's hashed content, so declarations are as permanent as the work itself. */
export type Declarations = {
  funding: Funding[]; // empty = no specific funding
  competing_interests: string; // "" = the authors declare none
};

/** Where an imported work actually lives. Fjournal hosts its open review, not the work. */
export const SOURCE_KINDS = {
  arxiv: "arXiv",
  biorxiv: "bioRxiv",
  medrxiv: "medRxiv",
  doi: "DOI",
} as const;
export type SourceKind = keyof typeof SOURCE_KINDS;

/**
 * A snapshot of an external work's metadata, part of the version's hashed content. It records
 * what the source said at retrieval time, so later changes at the source are visible as new versions.
 */
export type SourceRecord = {
  kind: SourceKind;
  id: string; // arXiv identifier without version, or lower-case DOI
  version: string | null; // the source's own version number, for arXiv/bioRxiv/medRxiv
  url: string; // landing page of this version
  venue: string; // "arXiv · cs.CL", "bioRxiv · neuroscience", "The Lancet", "Zenodo"
  published: string | null; // date as given by the source (may be just a year)
  license_url: string | null;
  links: { label: string; url: string }[]; // e.g. the published journal version of a preprint
  notices: { type: string; url: string; date: string | null }[]; // retractions, corrections, concerns
  retrieved_at: string;
};
