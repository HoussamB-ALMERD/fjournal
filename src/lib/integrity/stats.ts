/**
 * Statistical consistency checks on manuscript text. Pure functions, no I/O.
 *
 * 1. Reported p-values vs. test statistics (the approach of statcheck, Nuijten et al. 2016):
 *    recompute p from t / F / r / χ² / z and its degrees of freedom, allowing for rounding.
 * 2. GRIM (Brown & Heathers 2017): a mean of n integer scores must equal k/n for some integer k.
 *
 * These flag things for a human to look at. A flag is not an accusation: typos, one-tailed tests
 * and non-integer measures all produce legitimate mismatches.
 */

// ─────────────────────────── Distributions ───────────────────────────

function gammaln(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) {
      del *= x / ++ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 3e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

export type TestKind = "t" | "F" | "r" | "chi2" | "z";

/** Two-tailed p for t, r, z; upper-tail p for F and χ². */
export function pValue(kind: TestKind, stat: number, df1?: number, df2?: number): number {
  switch (kind) {
    case "t":
      return ibeta(df1! / (df1! + stat * stat), df1! / 2, 0.5);
    case "r": {
      if (Math.abs(stat) >= 1) return 0;
      const t = stat * Math.sqrt(df1! / (1 - stat * stat));
      return ibeta(df1! / (df1! + t * t), df1! / 2, 0.5);
    }
    case "F":
      return stat <= 0 ? 1 : ibeta(df2! / (df2! + df1! * stat), df2! / 2, df1! / 2);
    case "chi2":
      return gammaQ(df1! / 2, stat / 2);
    case "z":
      return gammaQ(0.5, (stat * stat) / 2); // = erfc(|z|/√2)
  }
}

// ─────────────────────────── Extraction ───────────────────────────

export type Finding = {
  status: "pass" | "info" | "warn" | "fail";
  text: string; // the excerpt as reported
  message: string;
};

const decimals = (s: string) => (s.includes(".") ? s.split(".")[1].length : 0);
const num = (s: string) => Number(s.replace(/^\./, "0.").replace(/^-\./, "-0.").replace("−", "-"));
const NUM = String.raw`[-−]?\d*\.?\d+`;
const P = String.raw`p\s*([<>=≤≥])\s*(\d*\.\d+|0|1)`;

const PATTERNS: { kind: TestKind; re: RegExp }[] = [
  { kind: "t", re: new RegExp(String.raw`\bt\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*(${NUM})\s*,\s*${P}`, "gi") },
  { kind: "F", re: new RegExp(String.raw`\bF\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)\s*=\s*(${NUM})\s*,\s*${P}`, "g") },
  { kind: "r", re: new RegExp(String.raw`\br\s*\(\s*(\d+)\s*\)\s*=\s*(${NUM})\s*,\s*${P}`, "g") },
  {
    kind: "chi2",
    re: new RegExp(String.raw`(?:χ2|χ²|chi2|chi²|chi-square|X2|\\chi\^2|\\chi\^\{2\})\s*\(\s*(\d+)\s*(?:,\s*N\s*=\s*\d+\s*)?\)\s*=\s*(${NUM})\s*,\s*${P}`, "gi"),
  },
  { kind: "z", re: new RegExp(String.raw`\bz\s*=\s*(${NUM})\s*,\s*${P}`, "gi") },
];

type Reported = { kind: TestKind; text: string; stat: string; df1?: number; df2?: number; op: string; p: string };

export function extractTests(text: string): Reported[] {
  const out: Reported[] = [];
  for (const { kind, re } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (kind === "F") out.push({ kind, text: m[0], df1: +m[1], df2: +m[2], stat: m[3], op: m[4], p: m[5] });
      else if (kind === "z") out.push({ kind, text: m[0], stat: m[1], op: m[2], p: m[3] });
      else out.push({ kind, text: m[0], df1: +m[1], stat: m[2], op: m[3], p: m[4] });
    }
  }
  return out;
}

const fmtP = (p: number) => (p < 0.0001 ? p.toExponential(1) : p.toFixed(4));

/** Checks one reported test, accounting for rounding of the reported statistic. */
export function checkTest(r: Reported, alpha = 0.05): Finding {
  const stat = Math.abs(num(r.stat));
  const half = 0.5 * 10 ** -decimals(r.stat);
  const lo = Math.max(0, stat - half), hi = stat + half;
  // Larger statistic → smaller p.
  let pMin = pValue(r.kind, hi, r.df1, r.df2);
  const pMax = pValue(r.kind, lo, r.df1, r.df2);
  if (r.kind === "r" && hi >= 1) pMin = 0;
  if (!Number.isFinite(pMin) || !Number.isFinite(pMax)) return { status: "info", text: r.text, message: "Could not compute." };

  const rep = num(r.p);
  const repHalf = r.op === "=" ? 0.5 * 10 ** -decimals(r.p) : 0;
  const computed = pValue(r.kind, stat, r.df1, r.df2);
  const say = `Recomputed p ≈ ${fmtP(computed)} (range ${fmtP(pMin)}–${fmtP(pMax)} given rounding).`;

  let consistent: boolean;
  if (r.op === "<" || r.op === "≤") consistent = pMin < rep || (r.op === "≤" && pMin <= rep);
  else if (r.op === ">" || r.op === "≥") consistent = pMax > rep;
  else consistent = pMin <= rep + repHalf && pMax >= rep - repHalf;

  if (consistent) return { status: "pass", text: r.text, message: say };

  const reportedSig = r.op === "=" ? rep < alpha : r.op === "<" || r.op === "≤" ? rep <= alpha : false;
  const computedSig = computed < alpha;
  const oneTailed = r.op === "=" && r.kind !== "F" && r.kind !== "chi2" && Math.abs(computed / 2 - rep) <= repHalf + 1e-9;

  if (oneTailed)
    return { status: "warn", text: r.text, message: `${say} The reported value matches a one-tailed test — is that stated?` };
  if (reportedSig !== computedSig)
    return {
      status: "fail",
      text: r.text,
      message: `${say} The reported p and the test statistic disagree about significance at α = ${alpha}. Gross inconsistency.`,
    };
  return { status: "warn", text: r.text, message: `${say} The reported p doesn't match the statistic and degrees of freedom.` };
}

// ─────────────────────────── GRIM ───────────────────────────

const GRIM_RE = /\bM\s*=\s*(\d+\.\d+)[^()\n]{0,60}?\b[nN]\s*=\s*(\d+)|\b[nN]\s*=\s*(\d+)[^()\n]{0,60}?\bM\s*=\s*(\d+\.\d+)/g;

/** True when some integer total k gives k/n that rounds to the reported mean. */
export function grimConsistent(mean: string, n: number): boolean {
  const d = decimals(mean);
  const m = Number(mean);
  // Inclusive bounds accept any rounding convention the authors may have used.
  const lo = m - 0.5 * 10 ** -d - 1e-12, hi = m + 0.5 * 10 ** -d + 1e-12;
  const k0 = Math.floor(m * n);
  for (let k = k0 - 1; k <= k0 + 2; k++) if (k / n >= lo && k / n <= hi) return true;
  return false;
}

export function grimCheck(text: string): Finding[] {
  const out: Finding[] = [];
  for (const m of text.matchAll(GRIM_RE)) {
    const mean = m[1] ?? m[4];
    const n = Number(m[2] ?? m[3]);
    // Only testable when there are fewer participants than possible decimal values.
    if (n <= 0 || n >= 10 ** decimals(mean)) continue;
    out.push(
      grimConsistent(mean, n)
        ? { status: "pass", text: m[0], message: `Mean ${mean} is possible for n = ${n}.` }
        : {
            status: "warn",
            text: m[0],
            message: `A mean of ${mean} is impossible for n = ${n} if each person contributed one integer score (e.g. a single Likert item). Fine if the measure is continuous or multi-item — otherwise please check.`,
          },
    );
  }
  return out;
}

// ─────────────────────────── Entry point ───────────────────────────

export function statisticalChecks(text: string) {
  return {
    tests: extractTests(text).map((r) => checkTest(r)),
    grim: grimCheck(text),
  };
}
