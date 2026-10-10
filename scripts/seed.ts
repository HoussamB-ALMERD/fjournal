/**
 * Seeds a local Fjournal database with demo content.
 * Run: npm run seed   (refuses to run if the database already has users)
 */
import { db, get, run, tx, now } from "../src/lib/db";
import { appendReviewEntry, appendVersion, verifyLedger, type VersionContent } from "../src/lib/ledger";
import { award, weightOf } from "../src/lib/reputation";
import { hashPassword } from "../src/lib/password";
import { shortId } from "../src/lib/ids";
import { runIntegrityChecks } from "../src/lib/integrity/run";
import { importWork } from "../src/lib/import";
import type { ContributionType, Declarations, ReplicationOutcome } from "../src/lib/constants";
import { createCollection, decide, inviteMember, respondToInvitation, submitWork } from "../src/lib/collections";
import { saveReportSettings } from "../src/lib/report";
import { publishAssessment } from "../src/lib/index/index";

if (get("SELECT 1 FROM users LIMIT 1")) {
  console.log("Database already has data — skipping seed. Delete ./data to start fresh.");
  process.exit(0);
}

const PASSWORD = "fjournal-demo";
const users = {
  ada: ["Ada Okafor", "Computational biologist", "Independent researcher"],
  lin: ["Lin Wei", "Statistician. I review methods sections for fun.", "University of Somewhere"],
  sam: ["Sam Rivera", "Self-taught ML engineer; no degree, lots of replications.", ""],
  noor: ["Noor Haddad", "Experimental physicist.", "National Lab"],
  jo: ["Jo Mbeki", "Ecologist working on long-term field datasets.", ""],
} as const;
type H = keyof typeof users;
const uid: Record<H, string> = {} as never;

for (const [h, [name, bio, aff]] of Object.entries(users) as [H, readonly [string, string, string]][]) {
  uid[h] = `u_${shortId(10)}`;
  run(
    "INSERT INTO users (id, handle, display_name, password_hash, bio, affiliation, created_at) VALUES (?,?,?,?,?,?,?)",
    uid[h], h, name, hashPassword(PASSWORD), `${bio} (demo account)`, aff, now(),
  );
}

// Two moderators, because an appeal must be decided by someone other than the one who acted.
run("UPDATE users SET role = 'moderator' WHERE handle IN ('lin', 'noor')");

const NO_DECL: Declarations = { funding: [], competing_interests: "" };

let counter = 0;
function publish(owner: H, type: ContributionType, content: Omit<VersionContent, "license" | "declarations"> & Partial<Pick<VersionContent, "license" | "declarations">>,
  replication?: { of: string; outcome: ReplicationOutcome }) {
  const id = `${new Date().getUTCFullYear()}.demo${String(++counter).padStart(2, "0")}`;
  const ts = now();
  tx(() => {
    run(
      `INSERT INTO contributions (id, type, owner_id, latest_version, replication_of, replication_outcome, created_at, updated_at)
       VALUES (?,?,?,1,?,?,?,?)`,
      id, type, uid[owner], replication?.of ?? null, replication?.outcome ?? null, ts, ts,
    );
    appendVersion({ contributionId: id, number: 1, content: { license: "CC-BY-4.0", declarations: NO_DECL, ...content }, changeNote: "Initial version", createdBy: uid[owner], createdAt: ts });
    award(uid[owner], type === "replication" ? "replication_published" : type === "negative_result" ? "negative_result" : "contribution", id);
    if (replication?.outcome === "reproduced") {
      const target = get<{ owner_id: string }>("SELECT owner_id FROM contributions WHERE id = ?", replication.of)!;
      award(target.owner_id, "replicated_by_others", id);
    }
  });
  return id;
}

function newVersion(id: string, owner: H, content: VersionContent, note: string) {
  tx(() => {
    const n = get<{ v: number }>("SELECT latest_version AS v FROM contributions WHERE id = ?", id)!.v + 1;
    const ts = now();
    appendVersion({ contributionId: id, number: n, content, changeNote: note, createdBy: uid[owner], createdAt: ts });
    run("UPDATE contributions SET latest_version = ?, updated_at = ? WHERE id = ?", n, ts, id);
  });
}

function review(id: string, reviewer: H, v: number, s: [number, number, number, number], rec: string, body: string) {
  const rid = `r_${shortId(10)}`;
  const ts = now();
  tx(() => {
    run(
      `INSERT INTO reviews (id, contribution_id, version_number, reviewer_id, soundness, reproducibility, clarity, significance, recommendation, body, competing_interests, license, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      rid, id, v, uid[reviewer], ...s, rec, body, "", "CC-BY-4.0", ts,
    );
    appendReviewEntry(rid, ts);
  });
  return rid;
}

function helpful(reviewId: string, voter: H) {
  const r = get<{ reviewer_id: string }>("SELECT reviewer_id FROM reviews WHERE id = ?", reviewId)!;
  run("INSERT INTO review_votes (review_id, voter_id, created_at) VALUES (?,?,?)", reviewId, uid[voter], now());
  award(r.reviewer_id, "review_helpful", reviewId, weightOf(uid[voter]));
}

function endorse(id: string, who: H, note: string) {
  const owner = get<{ owner_id: string }>("SELECT owner_id FROM contributions WHERE id = ?", id)!.owner_id;
  run("INSERT INTO endorsements (contribution_id, user_id, note, created_at) VALUES (?,?,?,?)", id, uid[who], note, now());
  award(owner, "endorsement_received", `${id}:${uid[who]}`, weightOf(uid[who]));
}

// ── Content ──────────────────────────────────────────────────────────────

const v1: VersionContent = {
  title: "Soil moisture predicts seedling survival better than canopy cover in restored dry forests",
  authors: ["Jo Mbeki", "Ada Okafor"],
  license: "CC-BY-4.0",
  declarations: {
    funding: [{ funder: "Example Regional Conservation Trust (demo)", grant: "RCT-2019-044" }],
    competing_interests: "",
  },
  abstract:
    "Using 6 years of plot-level monitoring (n = 412 plots) in restored tropical dry forest, we find that early dry-season soil moisture explains more variance in 2-year seedling survival than canopy cover (ΔAIC = 18.4). Effect sizes are moderate and site-dependent; we report all model specifications we tried.",
  body: `## Methods

We fit mixed-effects logistic regressions of 2-year survival on standardized predictors with a random intercept per site:

$$\\operatorname{logit}(p_{ij}) = \\beta_0 + \\beta_1 \\, \\text{moisture}_{ij} + \\beta_2 \\, \\text{canopy}_{ij} + u_j$$

All 14 model specifications we tried are listed in \`models.csv\` in the code repository — including the ones that did not support our hypothesis.

## Results

| Model | Predictors | AIC |
|---|---|---|
| M1 | canopy | 1032.7 |
| M2 | moisture | 1014.3 |
| M3 | moisture + canopy | 1015.9 |

Plots with above-median moisture had higher survival, t(410) = 3.12, p = .002.

## Limitations

Moisture was measured at only two depths. Sites differ in restoration age, which we cannot fully separate from soil type.`,
  artifacts: [
    { kind: "data", label: "Plot monitoring data 2019–2025", url: "https://zenodo.org/records/0000000", pin: "sha256:9f2c…e1a" },
    { kind: "code", label: "Analysis repository", url: "https://github.com/example/dryforest-survival", pin: "a1b2c3d" },
  ],
};
const forest = publish("jo", "research", v1);

const r1 = review(forest, "lin", 1, [3, 4, 4, 4], "minor_issues",
  "The core comparison is sensible, and publishing all 14 specifications is exactly what more papers should do. My main concern is that M2 vs M3 differ by only 1.6 AIC, so the claim that moisture is *better than* canopy should be framed as moisture being *sufficient* given canopy. Please also report a site-level cross-validated AUC — AIC alone is not informative about out-of-sample prediction when sites are heterogeneous.");
const r2 = review(forest, "noor", 1, [4, 4, 3, 3], "minor_issues",
  "Clear and honest write-up. I reran the notebook from the pinned commit and got identical coefficients. Small issue: the moisture sensor calibration procedure is only described in the README of the repo, not in the paper; please move a short description into the Methods so the paper stands alone if the repo goes away.");
helpful(r1, "jo");
helpful(r1, "sam");
helpful(r2, "jo");

newVersion(forest, "jo", {
  ...v1,
  abstract: v1.abstract.replace("explains more variance", "is sufficient to explain the variance") +
    " Site-blocked cross-validation gives AUC 0.71 (moisture) vs 0.64 (canopy).",
  body: v1.body + "\n\n## Sensor calibration\n\nSensors were calibrated gravimetrically against 30 soil cores per site (details and raw calibration data in the data deposit).",
}, "Addressed reviews by @lin (reframed claim, added site-blocked CV AUC) and @noor (calibration now in Methods).");

review(forest, "sam", 2, [4, 5, 4, 3], "sound",
  "Version 2 addresses both earlier reviews well. I independently re-ran the cross-validation using the pinned data and code on a different machine and got AUCs within 0.01 of the reported values. The reframing of the main claim is appropriate. I would still like to see a sensitivity analysis excluding the two youngest restoration sites, but that is not blocking.");
endorse(forest, "ada", "Re-derived the main table from raw data.");
endorse(forest, "noor", "");

const repl = publish("sam", "replication", {
  title: "Independent replication: moisture vs canopy as predictors of seedling survival (3 additional sites)",
  authors: ["Sam Rivera"],
  abstract: "We applied the published analysis pipeline, unchanged, to 3 additional restoration sites (n = 96 plots). The direction and approximate magnitude of the moisture effect reproduced; the canopy effect was weaker than originally reported.",
  body: "## Approach\n\nWe used the authors' code at the pinned commit with no modifications other than input paths.\n\n## Result\n\nMoisture coefficient: 0.48 (original 0.52). Canopy coefficient: 0.11 (original 0.21).",
  artifacts: [
    { kind: "data", label: "Replication plots", url: "https://osf.io/example", pin: "" },
    { kind: "notebook", label: "Replication notebook", url: "https://github.com/example/replication-notebook", pin: "f00ba12" },
  ],
}, { of: forest, outcome: "reproduced" });
endorse(repl, "jo", "Thank you — this is exactly what the field needs.");

const neg = publish("noor", "negative_result", {
  title: "No detectable effect of ambient magnetic shielding on superconducting qubit T1 times",
  authors: ["Noor Haddad"],
  abstract: "Across 40 cooldowns we found no difference in T1 between shielded and unshielded configurations (mean difference 0.8 µs, 95% CI −2.1 to 3.7 µs). We publish this so other groups can stop spending cryostat time on it — or show us what we missed.",
  body: "## Setup\n\nAlternating shielded/unshielded cooldowns, randomized order, pre-registered analysis plan (linked).\n\n## Result\n\nNo effect within our sensitivity. Power analysis: we had 80% power to detect a 4 µs difference.",
  artifacts: [{ kind: "data", label: "Raw T1 traces", url: "https://zenodo.org/records/1111111", pin: "" }],
});
const r3 = review(neg, "lin", 1, [5, 4, 5, 3], "sound",
  "Pre-registration plus a stated power analysis makes this negative result genuinely informative: the CI rules out effects larger than ~4 µs. I would add the analysis code (currently only data is linked) so the Open badge applies and the pre-registered analysis can be re-run end-to-end by readers.");
helpful(r3, "noor");

const ml = publish("ada", "research", {
  title: "A 2-parameter baseline matches published deep models on the XYZ protein stability benchmark",
  authors: ["Ada Okafor"],
  abstract: "A logistic model using only hydrophobicity change and residue burial matches three published deep-learning models on the XYZ benchmark (Spearman 0.61 vs 0.59–0.63). We argue the benchmark may be saturated by simple features.",
  body: "## Claim\n\nSimple features carry most of the signal measured by this benchmark. The baseline beat the median deep model on held-out folds, t(48) = 1.45, p = .04, and residue burial alone predicted stability, r(118) = .41, p < .001.\n\n## Caveat\n\nWe have not tested on out-of-family proteins.",
  declarations: {
    funding: [],
    competing_interests: "A.O. is an unpaid maintainer of an open-source protein feature library used in this analysis.",
  },
  artifacts: [
    { kind: "code", label: "Baseline code", url: "https://github.com/example/two-param-baseline", pin: "c0ffee1" },
    { kind: "data", label: "Benchmark splits used", url: "https://zenodo.org/records/2222222", pin: "" },
  ],
});
publish("sam", "replication", {
  title: "Replication attempt: 2-parameter baseline on out-of-family split",
  authors: ["Sam Rivera"],
  abstract: "On a stricter out-of-family split, the 2-parameter baseline drops to Spearman 0.38 while deep models hold at ~0.55. The original in-distribution result reproduces, but the broader saturation claim does not.",
  body: "## Result\n\nIn-distribution: reproduced (0.60). Out-of-family: baseline 0.38, deep models 0.53–0.57.",
  artifacts: [{ kind: "code", label: "Split + eval code", url: "https://github.com/example/ood-split", pin: "beef123" }],
}, { of: ml, outcome: "failed" });

// A collection run by a board, with a fictional lineage. Its decisions touch demo works only.
const demoBoard = createCollection(uid.noor, "open-field-methods", {
  name: "Open Field & Lab Methods",
  tagline: "Careful empirical work, its replications and its null results (demo collection)",
  scope: "Empirical studies in ecology and experimental physics where the data and analysis can be checked: original findings, replications and negative results alike.",
  policy:
    "We select work when:\n- the claims follow from the data and analyses shown;\n- data and code are available, or their absence is justified;\n" +
    "- the public reviews raise no unresolved problem with the methods.\n\nNegative results and replications are judged by the same standard as positive findings.",
  min_reviews: 2,
  accepts_submissions: 1,
  accent: "#0f766e",
  continues: { journal: "Annals of Field Methods (fictional)", publisher: "Example Press", statement_url: "https://example.org/demo-board-statement", year: 2026 },
});
const demoId = get<{ id: string }>("SELECT id FROM collections WHERE slug = ?", demoBoard)!.id;
inviteMember(uid.noor, demoId, "lin", "editor");
respondToInvitation(uid.lin, demoId, true);
inviteMember(uid.noor, demoId, "jo", "editor");
respondToInvitation(uid.jo, demoId, true);
inviteMember(uid.noor, demoId, "sam", "editor"); // left pending, to show invitations
// Jo is on the board, but submits as an author and can't decide on their own paper.
submitWork(uid.jo, demoId, forest, "Revised after public review; data and code pinned.");
decide(uid.lin, demoId, forest, {
  select: true,
  note:
    "Selected. Both v1 reviews asked for a reframed claim and out-of-sample validation; v2 does both, and an independent " +
    "re-run (review by @sam) and a replication on three new sites reproduce the main effect. Data and code are pinned.",
  competingInterests: "",
});
// Noor is the managing editor and an author here: someone else has to decide, and it needs one more review first.
submitWork(uid.noor, demoId, neg, "Pre-registered null result.");

// Jo's report shows a statement and chosen highlights; the others fall back to their most scrutinized work.
saveReportSettings(
  uid.jo,
  "I run long-term field plots in restored dry forests. I publish every model specification I fit, and I treat reviews and replications of my work as part of the work. (Demo account.)",
  [forest],
);

// Journal Integrity Index demo: a FICTIONAL journal with synthetic measurements (ISSN 0000-0000, Crossref's
// 10.5555 test prefix). Real journals are only ever measured by real sweeps (npm run index -- sweep).
{
  const ts = now();
  run(
    "INSERT INTO index_journals (issn, title, publisher, issns, field, created_at) VALUES (?,?,?,?,?,?)",
    "0000-0000", "Journal of Demonstration Results (fictional)", "Example Press (fictional)", JSON.stringify(["0000-0000"]), "Demonstration", ts,
  );
  run(
    `INSERT INTO index_assessments (id, issn, method_version, window_from, window_until, sample_target, total_articles, retracted, concerns,
       retraction_days, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "ia_demo", "0000-0000", "1.0-draft", "2019-01-01", "2021-12-31", 60, 4800, 6, 2, JSON.stringify([210, 380, 512, 640, 905, 1300]),
    "Demonstration data: a fictional journal with synthetic measurements, to show how assessments look.", uid.lin, ts,
  );
  const classes = ["supplement", "repository", "supplement", "request", "repository", "restricted", "supplement", "none", "link", "repository"];
  for (let i = 1; i <= 60; i++) {
    const tests = i % 2 ? 4 + (i % 5) : 0;
    const gross = tests && i % 11 === 1 ? 1 : 0;
    const inconsistent = tests && i % 5 === 1 ? 1 + gross : gross;
    const cls = classes[i % classes.length];
    run(
      `INSERT INTO index_articles (assessment_id, doi, title, issued, license_url, cc_license, fulltext, tests, inconsistent, gross, findings, data_class, data_excerpt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "ia_demo", `10.5555/demo.${String(i).padStart(3, "0")}`, `Synthetic article ${i} (demonstration)`, `20${19 + (i % 3)}-0${1 + (i % 9)}-15`,
      i % 4 ? "https://creativecommons.org/licenses/by/4.0/" : null, i % 4 ? 1 : 0, "synthetic", tests, inconsistent, gross,
      JSON.stringify(gross ? [{ status: "fail", text: "t(28) = 1.20, p = .03", message: "Recomputed p ≈ 0.2402. The reported p and the test statistic disagree about significance at α = 0.05. Gross inconsistency." }] : []),
      cls, cls === "none" ? null : `Synthetic statement for class "${cls}".`,
    );
  }
}
publishAssessment({ id: uid.noor }, "ia_demo");

// Real papers opened for review, so imported records can be explored. Demo accounts never review
// them: fabricated reviews of real people's work would be exactly what Fjournal stands against.
const REAL_WORKS = [
  "arXiv:1706.03762", // preprint with many versions
  "10.1126/science.aac4716", // Open Science Collaboration (2015), Estimating the reproducibility of psychological science
  "10.1016/S0140-6736(97)11096-0", // retracted by the publisher: shows how retraction notices surface
  "10.1371/journal.pone.0215030", // open-access article with APA statistics: full-text checks
];

void (async () => {
  console.log("Importing real works for review (needs network; skipped if offline)...");
  for (const w of REAL_WORKS) {
    try {
      const r = await importWork(w, uid.sam);
      console.log(`  ${w} → fj:${r.id}`);
    } catch (e) {
      console.log(`  ${w} skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("Running integrity checks on every version (fetches linked artifacts)...");
  for (const { seq } of db().prepare("SELECT seq FROM versions ORDER BY seq").all() as { seq: number }[]) await runIntegrityChecks(seq);

  console.log("Seeded demo data. Ledger:", verifyLedger());
  console.log("Moderators: lin, noor");
  console.log("Collection /j/open-field-methods: noor (managing), lin and jo (editors), sam (invited)");
  console.log("Journal Integrity Index: /journals (moderators only until FJOURNAL_INDEX_PUBLIC=1); demo journal is fictional");
  console.log(`Log in as any of: ${Object.keys(users).join(", ")} — password "${PASSWORD}"`);
  db().close();
})();
