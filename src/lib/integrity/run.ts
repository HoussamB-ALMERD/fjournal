import "server-only";
import { all, get, run, now } from "../db";
import { rowContent, type LedgerRow } from "../ledger";
import { statisticalChecks, type Finding } from "./stats";
import { checkImages } from "./images";
import { checkArtifacts } from "./artifacts";
import { fetchOpenFullText, type FullText } from "../import/fulltext";
import { manifestCheck } from "../repro/runs";
import type { SourceRecord } from "../constants";

export type CheckKind = "coverage" | "statistics" | "grim" | "images" | "artifacts" | "manifest";
export type CheckStatus = Finding["status"] | "error";

export const CHECK_LABELS: Record<CheckKind, { label: string; about: string }> = {
  coverage: {
    label: "Text analysed",
    about:
      "Imported works are checked against their open full text when the source offers a machine-readable copy " +
      "(arXiv HTML, bioRxiv/medRxiv JATS, Europe PMC). The text is analysed in memory, never stored or republished.",
  },
  statistics: {
    label: "Reported statistics",
    about: "Recomputes p-values from reported t, F, r, χ² and z statistics and their degrees of freedom (statcheck method).",
  },
  grim: {
    label: "Means vs. sample sizes (GRIM)",
    about: "Checks whether reported means are arithmetically possible for the sample size, assuming integer scores.",
  },
  images: {
    label: "Figure duplication",
    about: "Fingerprints every figure and compares it with every other figure on Fjournal, including mirrored copies.",
  },
  manifest: {
    label: "Reproduction manifest",
    about: "Looks for fjournal.json at the pinned commit, which tells the reproducibility bot how to run the code and which results it must produce.",
  },
  artifacts: {
    label: "Data & code links",
    about: "Confirms linked materials exist and still match their pinned checksum, commit or DOI.",
  },
};

const SEVERITY: Record<CheckStatus, number> = { info: 0, pass: 1, error: 2, warn: 3, fail: 4 };
export const worst = (s: CheckStatus[]): CheckStatus =>
  s.reduce<CheckStatus>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "info");

function summarize(kind: CheckKind, findings: Finding[]): { status: CheckStatus; summary: string } {
  if (findings.length === 0) {
    const none: Record<CheckKind, string> = {
      coverage: "",
      manifest: "",
      statistics: "No test statistics found in a checkable format (e.g. t(28) = 2.20, p = .036).",
      grim: "No means reported alongside a small sample size.",
      images: "No figures embedded in the text.",
      artifacts: "No data or code linked.",
    };
    return { status: "info", summary: none[kind] };
  }
  const count = (s: Finding["status"]) => findings.filter((f) => f.status === s).length;
  const [fail, warn, pass] = [count("fail"), count("warn"), count("pass")];
  const parts = [fail && `${fail} inconsistent`, warn && `${warn} to look at`, pass && `${pass} consistent`].filter(Boolean);
  return { status: worst(findings.map((f) => f.status)), summary: `${findings.length} checked: ${parts.join(", ") || "informational only"}.` };
}

function store(seq: number, kind: CheckKind, findings: Finding[] | Error) {
  const { status, summary } =
    findings instanceof Error ? { status: "error" as const, summary: `Check could not run: ${findings.message}` } : summarize(kind, findings);
  run("DELETE FROM integrity_checks WHERE version_seq = ? AND kind = ?", seq, kind);
  run(
    "INSERT INTO integrity_checks (version_seq, kind, status, summary, details, created_at) VALUES (?,?,?,?,?,?)",
    seq, kind, status, summary, JSON.stringify(findings instanceof Error ? [] : findings), now(),
  );
}

/**
 * Runs every automated check for one version. Safe to re-run (results are replaced).
 * Checks never block, hide or change anything — they only surface things for humans to examine.
 */
export async function runIntegrityChecks(seq: number) {
  const row = get<LedgerRow>("SELECT * FROM versions WHERE seq = ?", seq);
  if (!row) return;
  const c = rowContent(row);
  if (c.source) return checkImported(seq, c.abstract, c.source);

  const s = statisticalChecks(`${c.abstract}\n\n${c.body}`);
  store(seq, "statistics", s.tests);
  store(seq, "grim", s.grim);

  const [images, artifacts, manifest] = await Promise.allSettled([
    checkImages(seq, row.contribution_id, c.body),
    checkArtifacts(c.artifacts),
    manifestCheck(c.artifacts),
  ]);
  store(seq, "images", images.status === "fulfilled" ? images.value : (images.reason as Error));
  store(seq, "artifacts", artifacts.status === "fulfilled" ? artifacts.value : (artifacts.reason as Error));
  // Only shown when there is pinned code to talk about.
  if (manifest.status === "rejected") store(seq, "manifest", manifest.reason as Error);
  else if (manifest.value.length) store(seq, "manifest", manifest.value);
  else run("DELETE FROM integrity_checks WHERE version_seq = ? AND kind = 'manifest'", seq);
}

/** Works published elsewhere: the same statistical checks, on the open full text where one exists. */
async function checkImported(seq: number, abstract: string, source: SourceRecord) {
  let full: FullText | null = null;
  let problem: string | null = null;
  try {
    full = await fetchOpenFullText(source);
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  const coverage: Finding[] = full ? [{ status: "info", text: full.url, message: "Open, machine-readable copy that was analysed." }] : [];
  const [status, summary]: [CheckStatus, string] = full
    ? ["pass", `Full text from ${full.from}.`]
    : problem
      ? ["error", `Couldn't fetch the full text (${problem}); only the abstract was checked. Re-run later.`]
      : ["info", "No open machine-readable full text found (PDF-only or paywalled); only the abstract was checked."];
  run("DELETE FROM integrity_checks WHERE version_seq = ? AND kind = 'coverage'", seq);
  run(
    "INSERT INTO integrity_checks (version_seq, kind, status, summary, details, created_at) VALUES (?,?,?,?,?,?)",
    seq, "coverage", status, summary, JSON.stringify(coverage), now(),
  );
  const s = statisticalChecks(full ? full.text : abstract);
  store(seq, "statistics", s.tests);
  store(seq, "grim", s.grim);
}

export type CheckRow = {
  kind: CheckKind;
  status: CheckStatus;
  summary: string;
  details: Finding[];
  created_at: string;
};

const ORDER: CheckKind[] = ["coverage", "statistics", "grim", "images", "artifacts", "manifest"];

export function checksFor(seq: number): CheckRow[] {
  return all<Omit<CheckRow, "details"> & { details: string }>(
    "SELECT kind, status, summary, details, created_at FROM integrity_checks WHERE version_seq = ?",
    seq,
  )
    .map((r) => ({ ...r, details: JSON.parse(r.details) as Finding[] }))
    .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
