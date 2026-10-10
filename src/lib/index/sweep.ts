import "server-only";
import { all, get, run, tx, now } from "../db";
import { shortId } from "../ids";
import { getJson } from "../import/sources";
import { fromCrossref } from "../import/sources";
import { fetchOpenFullText } from "../import/fulltext";
import { statisticalChecks } from "../integrity/stats";
import { METHOD_VERSION, classifyDataAvailability, isCc, isNotice, normalizeIssn } from "./method";

/**
 * Measures one journal over a publication window: whole-journal counts from Crossref (articles,
 * retractions, expressions of concern) and a random sample of articles read in full where an open
 * copy exists. The result is a draft; a different moderator must publish it.
 * Runs from the command line (npm run index), never inside a web request.
 */

export class IndexError extends Error {}

const API = "https://api.crossref.org";
const dateOf = (d?: { "date-parts"?: (number | null)[][] }) => {
  const p = d?.["date-parts"]?.[0]?.filter((x): x is number => typeof x === "number");
  return p?.length ? new Date(Date.UTC(p[0], (p[1] ?? 1) - 1, p[2] ?? 1)).toISOString().slice(0, 10) : null;
};
type Item = { DOI: string; title?: string[]; issued?: { "date-parts"?: (number | null)[][] }; "update-to"?: { DOI: string; type: string; updated?: { "date-parts"?: (number | null)[][] } }[] };
type List = { message: { "total-results": number; items: Item[]; "next-cursor"?: string } };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let lastCall = 0;

/**
 * Crossref's public API asks for restraint: every call to it, from any concurrent task, takes the next
 * paced slot, and backs off when told to slow down.
 */
async function politely<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const slot = Math.max(Date.now(), lastCall + 400);
    lastCall = slot;
    await sleep(slot - Date.now());
    try {
      return await call();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if ((status === 429 || status === 503 || status === 504) && attempt < 5) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw e;
    }
  }
}

async function crossref<T>(path: string): Promise<T> {
  const j = await politely(() => getJson<T>(`${API}${path}`));
  if (!j) throw new IndexError(`Crossref returned nothing for ${path}`);
  return j;
}

export async function journalInfo(issn: string) {
  const j = await crossref<{ message: { title: string; publisher: string; ISSN: string[] } }>(`/journals/${issn}`);
  return { title: j.message.title, publisher: j.message.publisher, issns: j.message.ISSN ?? [issn] };
}

const windowFilter = (from: string, until: string) => `type:journal-article,from-pub-date:${from},until-pub-date:${until}`;

export async function countArticles(issn: string, from: string, until: string) {
  return (await crossref<List>(`/journals/${issn}/works?filter=${windowFilter(from, until)}&rows=0`)).message["total-results"];
}

/**
 * A uniform random sample of the window's research articles (Crossref samples at most 100 per call; repeated
 * and de-duplicated). Correction and retraction notices typed as articles are skipped.
 */
export async function sampleArticles(issn: string, from: string, until: string, n: number) {
  const seen = new Map<string, { doi: string; title: string; issued: string | null }>();
  for (let attempt = 0; seen.size < n && attempt < Math.ceil(n / 50) + 5; attempt++) {
    const size = Math.min(100, n - seen.size + 10);
    const j = await crossref<List>(`/journals/${issn}/works?filter=${windowFilter(from, until)}&sample=${size}&select=DOI,title,issued`);
    for (const it of j.message.items) {
      const doi = it.DOI.toLowerCase();
      const title = it.title?.[0] ?? "";
      if (!seen.has(doi) && seen.size < n && !isNotice(title)) seen.set(doi, { doi, title, issued: dateOf(it.issued) });
    }
    if (j.message.items.length === 0) break;
  }
  return [...seen.values()];
}

/**
 * Articles published in the window that later received a notice of this type. Notices are found
 * through the journal's update records; each points to its original article, whose date is then looked up.
 */
export async function noticesInWindow(issn: string, from: string, until: string, type: "retraction" | "expression_of_concern") {
  const firstNotice = new Map<string, string | null>();
  let cursor = "*";
  for (let page = 0; page < 20; page++) {
    const j = await crossref<List>(
      `/journals/${issn}/works?filter=update-type:${type},from-pub-date:${from}&rows=500&cursor=${encodeURIComponent(cursor)}&select=DOI,issued,update-to`,
    );
    for (const it of j.message.items)
      for (const u of it["update-to"] ?? []) {
        if (u.type !== type) continue;
        const orig = u.DOI.toLowerCase();
        const at = dateOf(u.updated) ?? dateOf(it.issued);
        const prev = firstNotice.get(orig);
        if (prev === undefined || (at && (!prev || at < prev))) firstNotice.set(orig, at);
      }
    if (j.message.items.length < 500 || !j.message["next-cursor"]) break;
    cursor = j.message["next-cursor"];
  }
  const originals = [...firstNotice.keys()];
  const days: number[] = [];
  let count = 0;
  for (let i = 0; i < originals.length; i += 40) {
    const batch = originals.slice(i, i + 40);
    const j = await crossref<List>(`/works?filter=${batch.map((d) => `doi:${encodeURIComponent(d)}`).join(",")}&rows=100&select=DOI,issued`);
    for (const it of j.message.items) {
      const published = dateOf(it.issued);
      if (!published || published < from || published > until) continue;
      count++;
      const notice = firstNotice.get(it.DOI.toLowerCase());
      if (notice) days.push(Math.max(0, Math.round((Date.parse(notice) - Date.parse(published)) / 86400_000)));
    }
  }
  return { count, days };
}

export type MeasuredArticle = {
  doi: string; title: string; issued: string | null; license_url: string | null; cc_license: number | null; fulltext: string | null;
  tests: number; inconsistent: number; gross: number; one_tailed: number; findings: { status: string; text: string; message: string }[];
  data_class: string | null; data_excerpt: string | null; error: string | null;
};

/** Reads one article: licence from Crossref; statistics and data statement from its open full text, if any. */
export async function measureArticle(a: { doi: string; title: string; issued: string | null }): Promise<MeasuredArticle> {
  const out: MeasuredArticle = {
    ...a, license_url: null, cc_license: null, fulltext: null, tests: 0, inconsistent: 0, gross: 0, one_tailed: 0, findings: [],
    data_class: null, data_excerpt: null, error: null,
  };
  try {
    const w = await politely(() => fromCrossref(a.doi));
    if (!w) return { ...out, error: "No Crossref record" };
    out.title = w.title || a.title;
    out.license_url = w.source.license_url;
    out.cc_license = isCc(w.source.license_url) ? 1 : 0;
    const ft = await fetchOpenFullText(w.source);
    if (!ft) return out;
    out.fulltext = ft.from;
    // The same sentence can appear twice in a full text (abstract and body); count each reported test once.
    const seen = new Set<string>();
    const tests = statisticalChecks(ft.text).tests.filter((t) => {
      const key = t.text.replace(/\s+/g, " ").trim();
      return !seen.has(key) && !!seen.add(key);
    });
    out.tests = tests.length;
    for (const t of tests) {
      if (t.status === "pass" || t.status === "info") continue;
      out.findings.push({ status: t.status, text: t.text.slice(0, 300), message: t.message });
      if (/one-tailed/.test(t.message)) out.one_tailed++;
      else {
        out.inconsistent++;
        if (t.status === "fail") out.gross++;
      }
    }
    const d = classifyDataAvailability(ft.text);
    out.data_class = d.cls;
    out.data_excerpt = d.excerpt;
  } catch (e) {
    out.error = e instanceof Error ? e.message.slice(0, 300) : "failed";
  }
  return out;
}

async function pool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export async function sweep(args: {
  issn: string; field: string; from: string; until: string; sample: number; createdBy: string; log?: (m: string) => void;
}): Promise<string> {
  const log = args.log ?? (() => {});
  const issn = normalizeIssn(args.issn) ?? (() => { throw new IndexError(`"${args.issn}" is not a valid ISSN.`); })();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.until) || args.from > args.until)
    throw new IndexError("The window needs --from and --until as YYYY-MM-DD, in order.");
  if (args.until > new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10))
    throw new IndexError("The window must end at least a year ago, so retractions have had time to happen.");
  if (!args.field.trim()) throw new IndexError("Assign a --field, so the journal is compared with its peers.");
  if (!Number.isInteger(args.sample) || args.sample < 30 || args.sample > 500) throw new IndexError("--sample must be 30–500.");

  log(`Journal ${issn}…`);
  const info = await journalInfo(issn);
  const total = await countArticles(issn, args.from, args.until);
  if (total === 0) throw new IndexError(`Crossref lists no journal articles for ${issn} in that window.`);
  log(`${info.title} (${info.publisher}): ${total} articles in the window. Counting retractions…`);
  const retractions = await noticesInWindow(issn, args.from, args.until, "retraction");
  const concerns = await noticesInWindow(issn, args.from, args.until, "expression_of_concern");
  log(`${retractions.count} retracted, ${concerns.count} with an expression of concern. Sampling ${args.sample} articles…`);
  const sample = await sampleArticles(issn, args.from, args.until, args.sample);
  let done = 0;
  const measured = await pool(sample, 3, async (a) => {
    const m = await measureArticle(a);
    if (++done % 10 === 0) log(`  ${done}/${sample.length} articles read`);
    return m;
  });

  const id = `ia_${shortId(10)}`;
  await tx(async () => {
    const ts = now();
    if (await get("SELECT 1 FROM index_journals WHERE issn = ?", issn))
      await run("UPDATE index_journals SET title = ?, publisher = ?, issns = ?, field = ? WHERE issn = ?", info.title, info.publisher, JSON.stringify(info.issns), args.field.trim(), issn);
    else
      await run("INSERT INTO index_journals (issn, title, publisher, issns, field, created_at) VALUES (?,?,?,?,?,?)", issn, info.title, info.publisher, JSON.stringify(info.issns), args.field.trim(), ts);
    await run(
      `INSERT INTO index_assessments (id, issn, method_version, window_from, window_until, sample_target, total_articles, retracted, concerns, retraction_days, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, issn, METHOD_VERSION, args.from, args.until, args.sample, total, retractions.count, concerns.count, JSON.stringify(retractions.days), args.createdBy, ts,
    );
    for (const m of measured)
      await run(
        `INSERT INTO index_articles (assessment_id, doi, title, issued, license_url, cc_license, fulltext, tests, inconsistent, gross, one_tailed, findings, data_class, data_excerpt, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, m.doi, m.title, m.issued, m.license_url, m.cc_license, m.fulltext, m.tests, m.inconsistent, m.gross, m.one_tailed,
        JSON.stringify(m.findings), m.data_class, m.data_excerpt, m.error,
      );
  });
  log(`Draft assessment ${id} saved: ${measured.filter((m) => m.fulltext).length} of ${measured.length} sampled articles had open full text.`);
  return id;
}

export const draftsCount = async () => (await all<{ n: number }>("SELECT COUNT(*) AS n FROM index_assessments WHERE status = 'draft'"))[0]?.n ?? 0;
