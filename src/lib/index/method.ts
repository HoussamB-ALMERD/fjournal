/**
 * The Journal Integrity Index method. Pure: no database, no network — so every number can be
 * recomputed by anyone from the per-article data, and every rule is tested.
 *
 * Principles: separate indicators (never a composite score or a league table), uncertainty on every
 * figure, a minimum sample before any figure is shown, field baselines, and per-article evidence
 * that can be checked and corrected in public.
 */

export const METHOD_VERSION = "1.0-draft";
export const MIN_SAMPLE = 30; // below this, sample-based indicators say "insufficient data"
export const MIN_ARTICLES_FOR_RATES = 500; // below this many articles in the window, no retraction rate
export const MIN_JOURNALS_FOR_BASELINE = 3;

export type IndicatorKey = "statistics" | "data" | "license" | "retractions";

export const INDICATORS: Record<IndicatorKey, { label: string; question: string; caution: string }> = {
  statistics: {
    label: "Statistical reporting",
    question: "Of sampled articles whose open full text reports APA-style tests, how many contain a p-value that contradicts its own test statistic so that significance flips?",
    caution:
      "Only APA-formatted t, F, r, χ² and z tests in open full text are read, so many fields and paywalled articles are not covered. " +
      "Values matching a one-tailed test are shown but not counted. An inconsistency is often a typo; it is a reporting error, not evidence of misconduct.",
  },
  data: {
    label: "Data availability",
    question: "Of sampled articles with open full text, how many make their data available in a repository or with the paper?",
    caution:
      "Statements are classified by text patterns from the article's own data-availability statement, shown verbatim for each article. " +
      "It checks what the statement says, not whether the data actually exist or are usable.",
  },
  license: {
    label: "Open licence",
    question: "Of sampled articles, how many carry a Creative Commons licence on the published version, according to Crossref metadata?",
    caution: "Relies on publishers' Crossref metadata. Free-to-read articles without a licence are not counted as open.",
  },
  retractions: {
    label: "Retractions",
    question: "Of all articles the journal published in the window, how many have since been retracted, and how long did retraction take?",
    caution:
      "A higher rate is not simply worse: journals that investigate and retract openly will show more retractions than journals that don't. " +
      "Read it with the time to retraction. Counts come from retraction notices in Crossref, including Retraction Watch data, linked to the journal's articles; notices registered elsewhere can be missed.",
  },
};

// ───────────────────────────── Data availability statements ─────────────────────────────

export const DATA_CLASSES = {
  repository: "In a repository or archive (a link or identifier is given)",
  supplement: "In the article or its supplementary files",
  restricted: "Restricted, with a stated reason (e.g. privacy), possibly with an access route",
  request: "Only on request from the authors",
  link: "At a web address that isn't a recognised repository (may not last)",
  unclear: "A statement exists but doesn't fit these categories",
  none: "No data availability statement found",
} as const;
export type DataClass = keyof typeof DATA_CLASSES;
/** Counted as "data shared" by the indicator. */
export const SHARED: DataClass[] = ["repository", "supplement"];

const HEADING = /\b(data(?: and (?:code|materials|software))? availability(?: statement)?|availability of (?:data|supporting data)(?: and materials)?|data accessibility(?: statement)?|data sharing(?: statement)?)\b\s*[:.]?/i;
const REPOSITORY =
  // Bare DOIs only from data repositories (Zenodo, figshare, Dryad, OSF, Dataverse, Mendeley Data, PANGAEA, ICPSR):
  // a publisher's own supplement DOI is not a deposit.
  /(\b10\.(?:5281|6084|5061|17605|7910|17632|1594|3886)\/\S+|zenodo|figshare|osf\.io|open science framework|dryad|dataverse|github\.com|gitlab|ncbi\.nlm\.nih\.gov|\bgeo\b|accession (?:number|code|no)|bioproject|\bsra\b|ebi\.ac\.uk|arrayexpress|pangaea|openneuro|icpsr|uk data service|mendeley data|\bdeposited (?:in|at|to|with)\b|publicly available (?:at|from|in) (?:the )?\S+ (?:repository|database|archive))/i;
const SUPPLEMENT =
  /(within the (?:paper|manuscript|article)|in the (?:paper|manuscript|article) and its|supporting information|supplementary (?:material|information|data|files?|tables?)|included in (?:this|the) (?:published )?(?:article|paper|manuscript)|\bS\d+ (?:File|Table|Data(?:set)?|Appendix|Dataset)\b|\b10\.\d{4,9}\/\S+\.s\d{3}\b)/i;
const RESTRICTED =
  /(cannot be (?:shared|made (?:publicly )?available)|not (?:be )?(?:publicly )?available|restrict|confidential|ethic(?:al|s) (?:committee|restrictions?|reasons?)|privacy|proprietary|third[- ]party|legal reasons)/i;
const REQUEST = /((?:upon|on) (?:reasonable )?request|from the corresponding author|contact(?:ing)? the (?:corresponding )?authors?)/i;

const NEXT_SECTION = /\b(Funding(?: statement)?|Competing interests|Conflicts? of interest|Author contributions|Acknowledg(?:e)?ments|Ethics (?:statement|approval)|References)\b\s*[:.]?/;

/** Notices (corrections, retractions...) that Crossref types as journal articles: not research, so never sampled. */
export const isNotice = (title: string) =>
  /^\s*(correction|retraction|erratum|corrigendum|expression of concern|withdrawal|retracted|notice of)\b/i.test(title);

/** Statements sometimes name a contact person; their email addresses aren't needed to judge the statement. */
export const redactEmails = (s: string) => s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email removed]");

/** The paragraph after a heading, stopping at the next section. */
function statementAt(text: string, end: number): string {
  const rest = text.slice(end, end + 1500).replace(/^[\s:.\-–]+/, "");
  const para = rest.split("\n")[0];
  const cut = NEXT_SECTION.exec(para);
  return (cut && cut.index > 20 ? para.slice(0, cut.index) : para).trim().slice(0, 600);
}

const classify = (s: string): DataClass =>
  REPOSITORY.test(s)
    ? "repository"
    : SUPPLEMENT.test(s)
      ? "supplement"
      : RESTRICTED.test(s)
        ? "restricted"
        : REQUEST.test(s)
          ? "request"
          : /https?:\/\/\S+/i.test(s)
            ? "link"
            : "unclear";

/**
 * Finds the article's data availability statement and classifies it, returning the excerpt it judged.
 * In-text mentions ("see the Data Availability statement") are skipped in favour of a real statement.
 */
export function classifyDataAvailability(text: string): { cls: DataClass; excerpt: string | null } {
  const candidates = [...text.matchAll(new RegExp(HEADING.source, "gi"))]
    .map((m) => statementAt(text, m.index! + m[0].length))
    .filter((s) => s.length >= 25);
  if (candidates.length === 0) return { cls: "none", excerpt: null };
  const best = candidates.find((s) => classify(s) !== "unclear") ?? candidates[0];
  return { cls: classify(best), excerpt: redactEmails(best) };
}

// ───────────────────────────── Statistics ─────────────────────────────

/** 95% Wilson score interval for k successes out of n. Well-behaved for small n and proportions near 0 or 1. */
export function wilson(k: number, n: number, z = 1.959964): { p: number; lo: number; hi: number } {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const z2 = z * z;
  const d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ───────────────────────────── Indicators ─────────────────────────────

export type ArticleData = {
  doi: string;
  cc_license: number | null;
  fulltext: string | null;
  tests: number;
  inconsistent: number;
  gross: number;
  data_class: DataClass | null;
  excluded: IndicatorKey[];
};

export type AssessmentData = { total_articles: number; retracted: number; concerns: number; retraction_days: number[] };

/** A proportion with its interval, or null when the sample is too small to say anything. */
export type Proportion = { k: number; n: number; p: number; lo: number; hi: number } | { k: number; n: number; insufficient: true };

function proportion(k: number, n: number, min: number): Proportion {
  return n < min ? { k, n, insufficient: true } : { k, n, ...wilson(k, n) };
}

export type Indicators = {
  sample: number;
  with_fulltext: number;
  statistics: { gross: Proportion; any: Proportion; tests: number };
  data: { shared: Proportion; by_class: Record<DataClass, number> };
  license: { cc: Proportion };
  retractions: { rate: Proportion; per10k: number | null; concerns: Proportion; median_days: number | null };
};

export function computeIndicators(articles: ArticleData[], a: AssessmentData): Indicators {
  const usable = (k: IndicatorKey) => articles.filter((x) => !x.excluded.includes(k));
  const stats = usable("statistics").filter((x) => x.tests > 0);
  const data = usable("data").filter((x) => x.fulltext && x.data_class);
  const lic = usable("license").filter((x) => x.cc_license !== null);
  const by_class = Object.fromEntries(Object.keys(DATA_CLASSES).map((c) => [c, 0])) as Record<DataClass, number>;
  for (const x of data) by_class[x.data_class!]++;
  const rate = proportion(a.retracted, a.total_articles, MIN_ARTICLES_FOR_RATES);
  return {
    sample: articles.length,
    with_fulltext: articles.filter((x) => x.fulltext).length,
    statistics: {
      gross: proportion(stats.filter((x) => x.gross > 0).length, stats.length, MIN_SAMPLE),
      any: proportion(stats.filter((x) => x.inconsistent > 0).length, stats.length, MIN_SAMPLE),
      tests: stats.reduce((s, x) => s + x.tests, 0),
    },
    data: { shared: proportion(data.filter((x) => SHARED.includes(x.data_class!)).length, data.length, MIN_SAMPLE), by_class },
    license: { cc: proportion(lic.filter((x) => x.cc_license === 1).length, lic.length, MIN_SAMPLE) },
    retractions: {
      rate,
      per10k: "insufficient" in rate ? null : (a.retracted / a.total_articles) * 10_000,
      concerns: proportion(a.concerns, a.total_articles, MIN_ARTICLES_FOR_RATES),
      median_days: median(a.retraction_days),
    },
  };
}

/** Field baseline: pooled counts across journals in the field, only once there are enough journals. */
export function pooled(parts: { k: number; n: number }[], min: number): Proportion | null {
  if (parts.length < MIN_JOURNALS_FOR_BASELINE) return null;
  const k = parts.reduce((s, x) => s + x.k, 0);
  const n = parts.reduce((s, x) => s + x.n, 0);
  return proportion(k, n, min);
}

export const isCc = (url: string | null) => (url ? /creativecommons\.org\/(licenses|publicdomain)\//i.test(url) : false);

/** ISSN with a valid check digit (ISO 3297), normalised to "1234-567X". */
export function normalizeIssn(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^0-9X]/g, "");
  if (!/^\d{7}[\dX]$/.test(s)) return null;
  const sum = [...s.slice(0, 7)].reduce((acc, d, i) => acc + Number(d) * (8 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  if ((check === 10 ? "X" : String(check)) !== s[7]) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
