/**
 * The reproduction manifest: `fjournal.json` at the root of the code repository, at the pinned commit.
 * It says how to run the code and which numbers the run must produce, each tied to a claim in the paper.
 * Pure: shared by the worker, the integrity checks and the in-browser validator.
 */

export const MANIFEST_FILE = "fjournal.json";

/** Official images only, optionally pinned by digest (recommended: it makes the environment exact). */
const IMAGE_PATTERNS = [
  /^python:3\.(9|1[0-4])(\.\d+)?(-slim)?(-bookworm|-trixie)?$/,
  /^r-base:4\.\d+(\.\d+)?$/,
  /^rocker\/(r-ver|tidyverse|verse):4\.\d+(\.\d+)?$/,
  /^julia:1\.\d+(\.\d+)?$/,
  /^node:(20|22|24)(\.\d+)*(-slim)?$/,
  /^continuumio\/miniconda3(:[\w.-]+)?$/,
  /^ubuntu:(22\.04|24\.04)$/,
];
export const ALLOWED_IMAGES_HINT = "python:3.12-slim, r-base:4.4.1, rocker/r-ver:4.4, julia:1.10, node:22-slim, continuumio/miniconda3, ubuntu:24.04";

export const LIMITS = { outputs: 50, runMinutes: 60, setupMinutes: 15, outputBytes: 5_000_000 };

export type Extract =
  | { json: string } // dot path with [i] indexes: "metrics.test[0].spearman"
  | { csv: { column: string | number; row?: number; where?: Record<string, string> } }
  | { after: string } // the first number that follows this literal text
  | { sha256: string }; // the whole file must hash to this (figures, exact tables)

export type OutputSpec = Extract & {
  claim: string;
  file: string;
  reported?: number | string; // a string keeps trailing zeros: "0.610" means ±0.0005
  tolerance?: number; // absolute
  relative_tolerance?: number;
};

export type Manifest = {
  version: 1;
  image: string;
  setup?: string; // runs WITH network (to install dependencies)
  run: string; // runs WITHOUT network
  timeout_minutes?: number;
  outputs: OutputSpec[];
};

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Rejects absolute paths, parent references and anything odd: the worker reads these out of the sandbox. */
export function safeRelativePath(p: string): boolean {
  return (
    p.length > 0 && p.length <= 300 && !p.startsWith("/") && !p.startsWith("\\") && !/^[a-z]:/i.test(p) &&
    !p.split(/[\\/]/).some((seg) => seg === ".." || seg === "") && /^[\w.\-/ ]+$/.test(p)
  );
}

export function parseManifest(text: string): Result<Manifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["The manifest must be a JSON object."] };
  if (raw.version !== 1) errors.push('"version" must be 1.');
  const image = raw.image;
  if (typeof image !== "string" || !IMAGE_PATTERNS.some((re) => re.test(image.replace(/@sha256:[0-9a-f]{64}$/, ""))))
    errors.push(`"image" must be an official image such as ${ALLOWED_IMAGES_HINT} (optionally @sha256:… pinned).`);
  if (raw.setup !== undefined && (typeof raw.setup !== "string" || raw.setup.length > 2000)) errors.push('"setup" must be a command (max 2000 characters).');
  if (typeof raw.run !== "string" || !raw.run.trim() || raw.run.length > 2000) errors.push('"run" is required: the command that produces the results.');
  if (raw.timeout_minutes !== undefined && !(Number.isInteger(raw.timeout_minutes) && (raw.timeout_minutes as number) >= 1 && (raw.timeout_minutes as number) <= LIMITS.runMinutes))
    errors.push(`"timeout_minutes" must be a whole number from 1 to ${LIMITS.runMinutes}.`);
  if (!Array.isArray(raw.outputs) || raw.outputs.length === 0 || raw.outputs.length > LIMITS.outputs)
    errors.push(`"outputs" must list 1–${LIMITS.outputs} results the run should reproduce.`);
  else
    raw.outputs.forEach((o: unknown, i: number) => {
      const at = `outputs[${i}]`;
      if (!isObj(o)) return errors.push(`${at} must be an object.`);
      if (typeof o.claim !== "string" || !o.claim.trim() || o.claim.length > 200) errors.push(`${at}.claim: say which claim in the paper this number supports.`);
      if (typeof o.file !== "string" || !safeRelativePath(o.file)) errors.push(`${at}.file must be a relative path inside the repository, without "..".`);
      const kinds = ["json", "csv", "after", "sha256"].filter((k) => k in o);
      if (kinds.length !== 1) return errors.push(`${at} needs exactly one of "json", "csv", "after" or "sha256".`);
      if ("json" in o && (typeof o.json !== "string" || !/^[\w$-]+(\.[\w$-]+|\[\d+\])*$/.test(o.json))) errors.push(`${at}.json must be a path like "metrics.test[0].auc".`);
      if ("csv" in o) {
        const c = o.csv;
        if (!isObj(c) || !(typeof c.column === "string" || Number.isInteger(c.column))) errors.push(`${at}.csv needs a "column" (name or index).`);
        else if (c.row !== undefined && !(Number.isInteger(c.row) && (c.row as number) >= 0)) errors.push(`${at}.csv.row must be a 0-based row number.`);
        else if (c.where !== undefined && !(isObj(c.where) && Object.values(c.where).every((v) => typeof v === "string"))) errors.push(`${at}.csv.where must map column names to values.`);
        else if (c.row === undefined && c.where === undefined) errors.push(`${at}.csv needs "row" or "where" to pick the row.`);
      }
      if ("after" in o && (typeof o.after !== "string" || !o.after || o.after.length > 200)) errors.push(`${at}.after must be the text just before the number.`);
      if ("sha256" in o) {
        if (typeof o.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(o.sha256)) errors.push(`${at}.sha256 must be 64 hex characters.`);
      } else {
        const rep = o.reported;
        if (!((typeof rep === "number" && Number.isFinite(rep)) || (typeof rep === "string" && /^-?\d*\.?\d+(e-?\d+)?$/i.test(rep))))
          errors.push(`${at}.reported must be the number as it appears in the paper.`);
        for (const k of ["tolerance", "relative_tolerance"] as const)
          if (o[k] !== undefined && !(typeof o[k] === "number" && (o[k] as number) >= 0)) errors.push(`${at}.${k} must be a non-negative number.`);
      }
    });
  return errors.length ? { ok: false, errors } : { ok: true, value: raw as unknown as Manifest };
}

/** Without an explicit tolerance, a value matches if it rounds to what was reported: "0.61" allows ±0.005. */
export function defaultTolerance(reported: number | string): number {
  const s = String(reported).toLowerCase();
  if (s.includes("e")) return Math.abs(Number(s)) * 1e-6;
  const decimals = s.includes(".") ? s.split(".")[1].length : 0;
  return 0.5 * 10 ** -decimals;
}

function jsonPath(data: unknown, path: string): unknown {
  let cur = data;
  for (const part of path.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    if (cur === null || cur === undefined) return undefined;
    cur = part.startsWith("[") ? (cur as unknown[])[Number(part.slice(1, -1))] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Minimal RFC 4180 parser: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += ch;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim()));
}

const NUMBER = /[-−]?\d*\.?\d+(?:[eE][-+]?\d+)?/;
const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().match(new RegExp(`^${NUMBER.source}$`));
  return m ? Number(m[0].replace("−", "-")) : null;
};

/** Pulls the observed value out of an output file. Returns a number, or a reason it couldn't. */
export function extractValue(spec: OutputSpec, content: Buffer): { value: number } | { problem: string } {
  const text = content.toString("utf8");
  if ("json" in spec) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { problem: `${spec.file} is not valid JSON.` };
    }
    const v = toNumber(jsonPath(data, spec.json));
    return v === null ? { problem: `No number at "${spec.json}" in ${spec.file}.` } : { value: v };
  }
  if ("csv" in spec) {
    const [header, ...rows] = parseCsv(text);
    if (!header) return { problem: `${spec.file} is empty.` };
    const col = typeof spec.csv.column === "number" ? spec.csv.column : header.findIndex((h) => h.trim() === spec.csv.column);
    if (col < 0 || col >= header.length) return { problem: `Column "${spec.csv.column}" not found in ${spec.file}.` };
    const where = spec.csv.where;
    const row = where
      ? rows.find((r) => Object.entries(where).every(([k, v]) => r[header.findIndex((h) => h.trim() === k)]?.trim() === v))
      : rows[spec.csv.row ?? -1];
    if (!row) return { problem: `No matching row in ${spec.file}.` };
    const v = toNumber(row[col]);
    return v === null ? { problem: `"${row[col]}" in ${spec.file} is not a number.` } : { value: v };
  }
  if ("after" in spec) {
    const i = text.indexOf(spec.after);
    if (i < 0) return { problem: `"${spec.after}" does not appear in ${spec.file}.` };
    const m = text.slice(i + spec.after.length, i + spec.after.length + 200).match(NUMBER);
    return m ? { value: Number(m[0].replace("−", "-")) } : { problem: `No number follows "${spec.after}" in ${spec.file}.` };
  }
  return { problem: "sha256 outputs are compared by hash, not value." };
}

export type OutputResult = {
  claim: string;
  file: string;
  reported: string | null;
  observed: string | null;
  tolerance: number | null;
  match: boolean;
  in_paper: boolean | null; // does the reported value literally appear in the paper's text?
  problem: string | null;
};

/** Compares one declared result against what the run produced. `sha256Of` hashes a buffer (kept injectable to stay pure). */
export function compareOutput(
  spec: OutputSpec,
  content: Buffer | null,
  paperText: string,
  sha256Of: (b: Buffer) => string,
): OutputResult {
  const base = { claim: spec.claim, file: spec.file };
  if ("sha256" in spec) {
    const got = content ? sha256Of(content) : null;
    return {
      ...base, reported: `sha256:${spec.sha256.slice(0, 12)}…`, observed: got ? `sha256:${got.slice(0, 12)}…` : null, tolerance: null,
      match: got === spec.sha256.toLowerCase(), in_paper: null, problem: content ? null : `${spec.file} was not produced.`,
    };
  }
  const reported = String(spec.reported);
  const inPaper = appearsIn(reported, paperText);
  if (!content) return { ...base, reported, observed: null, tolerance: null, match: false, in_paper: inPaper, problem: `${spec.file} was not produced.` };
  const got = extractValue(spec, content);
  if ("problem" in got) return { ...base, reported, observed: null, tolerance: null, match: false, in_paper: inPaper, problem: got.problem };
  const target = Number(reported);
  const tol = spec.tolerance ?? (spec.relative_tolerance !== undefined ? Math.abs(target) * spec.relative_tolerance : defaultTolerance(reported));
  return {
    ...base, reported, observed: String(got.value), tolerance: tol,
    match: Math.abs(got.value - target) <= tol + 1e-12, in_paper: inPaper, problem: null,
  };
}

/** "0.61" also matches ".61" in APA-style text. Purely informational. */
export function appearsIn(value: string, text: string): boolean {
  const forms = new Set([value, value.replace(/^(-?)0\./, "$1.")]);
  return [...forms].some((f) => new RegExp(`(^|[^\\d.])${f.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}(?!\\d)`).test(text));
}
