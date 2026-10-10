# Fjournal — Architecture & Design

> Open, community-evaluated scientific publishing. Zero fees, author-owned copyright,
> immutable versioning, public review, reputation earned by contribution quality.

The *why* lives in [MANIFESTO.md](MANIFESTO.md). This document explains how the build carries it out. Every
design decision below traces back to a structural harm of the journal system that it is
meant to remove.

---

## 1. Design principles → mechanisms

| Journal-system harm | Fjournal mechanism |
|---|---|
| Work shaped to fit a journal narrative | No editors, no "fit" decision. Anything that meets minimal integrity rules is posted immediately. |
| 3–4 anonymous gatekeepers with veto power | Open, signed, public, versioned reviews from anyone. No single review can block publication. Quality signal is an aggregate. |
| APCs and subscriptions | No payment code exists in the system. Zero author fees, zero reader fees — enforced by the absence of a paywall layer, not by policy. |
| Copyright transfer | Author keeps copyright. License chosen per version (CC-BY default, CC-BY-SA, CC-BY-NC, CC0, All Rights Reserved). Fjournal only needs a non-exclusive right to host and display. |
| Credentialism | Identity = handle (+ optional ORCID link). Degrees and affiliations are optional free-text and never weighted in reputation. |
| Negative results & replications undervalued | `negative_result` and `replication` are first-class contribution types. Replications are typed links to the original with an explicit outcome and are rendered prominently on the original. Reputation rewards them. |
| Prestige & storytelling over reproducibility | The headline quality signal is a **Scrutiny Record**: number and depth of reviews, replication outcomes, artifact availability (data/code/notebooks), and version history — not a venue name. |

## 2. Core domain model

```
User ──< Contribution ──< Version (immutable, hash-chained)
                │              │
                │              ├──< Artifact   (data / code / notebook links, pinned commit or checksum)
                │              └──< Review     (public, signed, scored on rubric, itself versionable)
                │                       └──< ReviewVote ("helpful" signal → reviewer reputation)
                ├──< Endorsement   (lightweight "I checked this and stand behind it")
                ├──< Comment
                └──< Replication link (Contribution of type=replication → target Contribution, outcome)
User ──< ReputationEvent (append-only ledger; score is a pure function of it)
```

### Contribution types
`research`, `replication`, `negative_result`, `dataset`, `method`, `software`, `review_article`, `incremental`.

### Immutable versioning & proof of priority
Every edit creates a new `Version`. Versions are never updated or deleted.

```
content_hash = SHA-256(canonical JSON of {title, abstract, body, authors, license, artifacts})
chain_hash   = SHA-256(prev_chain_hash | content_hash | contribution_id | version | created_at_iso)
```

- There is **one platform-wide chain**: `prev_chain_hash` is the previous version appended
  to the ledger by anyone. Altering or backdating any entry breaks every later hash.
- The ledger (`/ledger`, `/api/ledger`) is publicly downloadable as JSON so anyone can mirror
  it, and the server re-verifies the whole chain from stored content on every ledger view.
- **Anchoring (roadmap):** periodically commit a Merkle root of the ledger to an external
  timestamping service (OpenTimestamps → Bitcoin, and/or a Zenodo deposit with a DOI).
  This makes priority provable even if Fjournal itself disappears or misbehaves.
- Each version has a **priority receipt** (JSON) the author can download and keep.

### Licensing
One-click selector at submission; CC-BY-4.0 preselected. The license is part of the
hashed content, so it is provable which license applied to which version at what time.
Changing license = new version (old versions keep their original license, as the law requires).

## 3. Evaluation: replacing the 3-reviewer veto

### Reviews
- Anyone with an account can review any version.
- Reviews are public, signed with the reviewer's handle, timestamped, and attached to the
  specific version they evaluated (so reviews don't silently "carry over" to changed content).
- Structured rubric (1–5): **soundness**, **reproducibility**, **clarity**, **significance**
  plus free text and a recommendation: `sound`, `minor_issues`, `major_issues`, `unsound`.
- Reviews can be voted "helpful" by others; this is what earns reviewers reputation.
  Reviews that merely say "reject" without engaging won't be voted helpful and earn nothing.

### Scrutiny Record (the signal that replaces "published in Journal X")
Computed per contribution:
- `reviews` — count, distinct reviewers, reputation-weighted mean rubric scores
- `replications` — reproduced / partially reproduced / failed to reproduce
- `endorsements` — count, reputation-weighted
- `openness` — has data? has code? has notebook? pinned to commit/checksum?
- `versions` — how many times improved in response to critique
- Status badges, each with an explicit, published rule:
  - **Open** — data + code artifacts attached
  - **Scrutinized** — ≥3 reviews from ≥3 distinct reviewers with weighted soundness ≥ 3.5
  - **Replicated** — ≥1 independent replication with outcome `reproduced`
  - **Contested** — any `failed` replication or weighted soundness < 2.5

Badge rules are deliberately simple and public: legitimacy comes from being auditable.

## 3b. Integrity checks (data, not trust)
Run after every version is published (`after()`), re-runnable by the author or a moderator,
results public on the contribution page. Code: `src/lib/integrity/`.

| Check | Method |
|---|---|
| Reported statistics | Parse t/F/r/χ²/z with df and p; recompute p allowing for rounding of the statistic (statcheck, Nuijten et al. 2016). Gross inconsistency = significance decision flips at α = .05. One-tailed reporting is recognised. |
| GRIM | A mean of n integer scores must equal k/n (Brown & Heathers 2017). Flagged as "look at this", because multi-item and continuous measures are legitimate exceptions. |
| Figure duplication | 64-bit dHash of each embedded figure and of its mirror image, plus SHA-256; compared across all other contributions and within the same version. |
| Data & code links | SHA-256 pins are re-downloaded and verified; GitHub commit pins checked via the API; DOIs resolved. |

All network fetches go through `safe-fetch.ts`, which validates the resolved IP at connect
time (blocking private, loopback and link-local ranges against SSRF), re-validates every
redirect, and caps size and time. Checks never hide, block or penalise anything.

## 3c. Declarations
Each version carries `declarations = { funding[], competing_interests }`, which is part of the
hashed content (versions from before declarations existed omit the key and hash unchanged).
Reviewers must declare competing interests too. Both are required at submission.

## 3d. Moderation
- Allowed reasons are an enum in `constants.ts`: fabrication, plagiarism (→ **retract**: stays
  readable with a notice), spam, harassment, privacy, unlawful (→ **hide**: replaced by a notice).
  There is no "disagreement" or "low quality" reason, so it can't be selected.
- `moderation_actions` is an append-only public log: moderator, reason, public explanation,
  and an evidence link (required for fabrication or plagiarism).
- A moderator can't act on anything attached to their own contribution.
- Appeals are filed by the affected author and decided in public by a *different* moderator.
  Overturning appends a `restore` action; nothing is deleted.
- Reputation earned from moderated content is offset by appended `moderation_reversal`
  events, and restored by `moderation_restored` if overturned.
- Ledger entries are never removed, even for hidden content.

## 3e. Imported works ("review any paper")
Journals keep their power partly because the judgement of a paper happens where it is printed.
Fjournal separates the two: any work, published anywhere, can be opened for public review.

- **Sources** (all open, no keys): arXiv API (+ OAI-PMH for the license), bioRxiv/medRxiv API,
  Crossref (journal DOIs, including Retraction Watch notices via `updated-by`), DataCite (datasets,
  software, repositories). Code: `src/lib/import/`.
- **Model:** a contribution with `owner_id = NULL`, `source_kind`/`source_id` (unique), and
  `imported_by`. Nobody owns or can edit it; importing earns no reputation (30 per hour per member).
  Reviews, replications, endorsements and comments work as usual. Reviewers and replicators earn
  reputation, and endorsements credit no one.
- **Ledger:** each version stores a `source` snapshot (venue, version, URL, license, links, publisher
  notices, retrieval time) inside the hashed content, so a review always points at exactly what was
  reviewed. Only metadata and the abstract are stored. The full text stays at the source.
- **Versions:** a newer version at arXiv/bioRxiv/medRxiv becomes a new version here when anyone
  asks for it. Journal DOIs are a single version.
- **Checks:** the statistics and GRIM checks run on the open full text when one exists (arXiv HTML,
  bioRxiv/medRxiv JATS, Europe PMC). The text is analysed in memory and never stored. A "Text
  analysed" row says which text was used.
- **Moderation:** Fjournal can't retract work it doesn't publish, so retraction reasons are refused
  for imports. Evidence belongs in a public review. Spam or unlawful imports can still be hidden, and the
  importer answers for (and may appeal) that.

## 3f. Citable reviews
Peer review is the scholarly labour journals take for free and credit to nobody. On Fjournal a
review is a publication:

- **Permanent and tamper-evident.** Reviews can't be edited. Each one is appended to a second hash
  chain (`review_ledger`) whose content hash covers the scores, text, declared interests, license,
  reviewer and the content hash of the exact version reviewed. `verifyLedger()` checks both chains.
  Reviews written before the chain existed were backfilled in order by migration 3.
- **Licensed by the reviewer** (CC BY by default), like any other work.
- **Citable:** `/r/<id>` with Highwire `citation_*` tags; BibTeX, RIS and CSL-JSON (`type: review`)
  per review and for a reviewer's whole record (`/u/<handle>/reviews`).
- **DOIs on request** (reviewer only, one per review, 25/day): DataCite schema 4,
  `resourceTypeGeneral: PeerReview`, `relationType: Reviews` pointing at the reviewed work's DOI,
  arXiv ID or Fjournal URL. The creator's ORCID is included **only if verified** by sign-in, so
  nobody can attach a review to someone else's iD. Registration runs after the response, is
  idempotent (PUT) and can be retried. A DOI of a review later removed by moderation resolves to the
  removal notice.

## 3i. Journal Integrity Index
Turning the scrutiny around, with the care that requires. Code: `src/lib/index/` — `method.ts` is pure
(indicators, Wilson intervals, the data-statement classifier, ISSN check digits) and fully unit-tested;
`sweep.ts` measures; `index.ts` stores, publishes and corrects.

- **Off by default.** Results are visible to moderators only until `FJOURNAL_INDEX_PUBLIC=1`; the method page
  is public from the start so it can be criticised before any result is.
- **Measurement (method 1.0-draft).** Per journal and publication window (ending ≥ 1 year ago): the article count,
  articles later retracted or given an expression of concern (Crossref notices incl. Retraction Watch, traced
  through `update-to` to originals and filtered to the window) with days to retraction; and a uniform random
  sample (Crossref `sample`, notices skipped) read for licence (Crossref) and, where open full text exists
  (Europe PMC), APA statistics (statcheck method, duplicates counted once) and the data availability statement
  (pattern classes, quoted with emails removed). Crossref calls are serialised, paced and back off on 429/503.
- **Presentation.** Four separate indicators; every proportion with a 95% Wilson interval; "insufficient data"
  below 30 sampled articles (500 for retraction rates); field baselines pooled once ≥ 3 journals share a field;
  alphabetical, no composite, no rank; caveats on each indicator (e.g. more retractions can mean better policing);
  every sampled article listed with the evidence.
- **Accountability.** Sweeps are attributed; publication needs a second moderator and fixes
  `sha256(canonical assessment + articles)`, and the page shows whether measurements changed since. Journals'
  replies are published verbatim after a moderator records how identity was confirmed. Anyone can request
  corrections; accepted ones remove the article from that indicator (the figure updates, the publication hash
  stays intact, and the correction is listed). Assessments can be superseded or withdrawn with a public reason.
- **Demo data** is a fictional journal (ISSN 0000-0000, Crossref test prefix 10.5555). Real journals are only
  ever shown from real sweeps.

## 3h. Scrutiny reports (for hiring and funding committees)
Committees that signed DORA or CoARA have committed to judge the work, not the venue, and need a
tool that makes that practical. `/u/<handle>/report` is one A4 page built by `buildReport()` in
`src/lib/report.ts`, shared by the page, the JSON API and frozen copies.

- **Works:** those published here plus imported works whose authorship was verified via ORCID.
  For each: public reviews (count, distinct people, reputation-weighted soundness, recommendations),
  independent replications by outcome, data/code, bot re-run, worst automated check on the latest
  version, revision after review, and board selections. Period filters (3/5/10 years) use the
  real publication date, so an old paper imported today doesn't count as recent.
- **Service:** reviews written (helpful votes, DOIs, the three most helpful to read), replications
  performed (failed ones included), editorial board roles and public decisions.
- **Integrity:** every retraction, with its public moderation decision, and a count of removed
  items. Never capped, never optional.
- **The researcher controls only** a statement (≤ 800 characters, labelled self-reported) and up to
  5 highlighted works, shown with all their evidence. With none chosen, the most scrutinized are shown.
- **Deliberately absent:** reputation totals or any single score, impact factors, citation counts,
  h-indices, venue prestige, affiliation weighting.
- **Frozen copies:** any signed-in member can freeze a report (20/day). It is stored as data plus
  `sha256(canonical JSON)`; the printed copy carries `/report/<id>` and the hash, and
  `/api/reports/<id>` lets anyone recompute it. The report also records the three ledger heads.
- **Print:** `@media print` forces light colours, hides site chrome and fits A4. Verified with headless
  Chrome: typical reports and a worst case (5 highlights, full statement) print on one page.

## 3g. Collections (editorial boards)
"Bring your board, keep your community, drop the publisher." A collection is a board's public
judgement layered on open publication. It never gates publishing and never earns reputation.

- **Settings:** name, address (`/j/<slug>`), scope, selection criteria, the minimum number of
  public reviews a selection needs (1–10), whether authors may submit or editors only nominate, an
  accent colour, and an optional **lineage claim** (the journal the board left, its publisher, and a
  required link to the board's public statement). The claim is shown with that evidence and with
  how many board members verified their ORCID iD, so readers can judge it.
- **Board:** managing editors (also manage the board and settings) and editors. Joining takes an
  invitation *and* an acceptance. There is always at least one managing editor. Removals carry a
  public reason. Board service shows on profiles.
- **Works:** authors submit (members who published it, or who verified authorship of an imported
  paper through ORCID); editors nominate any work, including any arXiv/bioRxiv/DOI paper, which is
  imported first. Editors decide **select** or **not selected** with public reasoning and a
  competing-interests declaration. They can't decide on their own work. Selection requires the
  policy's minimum of public reviews. Nominations are selected or dropped, never publicly declined
  (the authors never asked). Authors can withdraw at any time, even after selection. A declined
  work can be resubmitted only with a new version. Selections can be withdrawn, with reasoning.
- **Accountability:** every board change and decision is appended to the **collection chain**
  (`collection_log`): `content_hash = sha256(canonical {collection_id, kind, actor_id, subject,
  payload, created_at})`, `chain_hash = sha256("collection|" + prev | content_hash | created_at)`.
  Decisions commit to the selected version's content hash, the review ids at that moment, and the
  hash of the policy in force; policy changes are snapshotted. `verifyLedger()` recomputes the chain
  **and replays it**, checking that every item's status, every membership and every collection's
  settings are exactly what the log says, so direct edits to the state tables are detected too.
- **Portability:** `/api/collections/<slug>` exports settings, board, items and the raw log, so a
  board can leave Fjournal with its record intact.
- Limits: 3 new collections per member per 30 days, 10 submissions per member per day, 30
  invitations per collection per day, 200 board members.

## 5c. Reproducibility bot
"Data and code available" is a promise; re-running the code is a check.

- **Contract:** `fjournal.json` at the root of the pinned commit: an allow-listed official image
  (optionally digest-pinned), `setup` (with network), `run` (without network), a timeout, and up to
  50 **declared results**, each tied to a claim in the paper and read from an output file (JSON path,
  CSV cell, number after a marker, or whole-file SHA-256). Default tolerance is the rounding
  interval of the reported value ("0.61" ⇒ ±0.005). Code: `src/lib/repro/`.
- **Separation:** the web app only enqueues (`repro_runs`), automatically on publication when
  `FJOURNAL_REPRO_ENABLED=1`, or on request (5/day per member, once an hour per version). A separate
  `npm run worker` process claims runs one at a time. Runs left behind by a crashed worker are
  marked as errors, never silently retried.
- **Sandbox (Docker):** nothing from the host is mounted. The source archive is copied into the setup
  container and extracted there. Setup runs with network, all capabilities dropped, no-new-privileges,
  and pids/memory/CPU limits; the result is snapshotted. The run uses `--network none`, uid 65534, the
  same limits and a hard timeout. Outputs come out through `docker cp`, which resolves paths inside
  the container; anything but a regular file (e.g. a symlink to a host path) is refused. Containers
  and snapshots are always removed. Optional gVisor (`FJOURNAL_SANDBOX_RUNTIME=runsc`).
- **Record:** status (reproduced / mismatch / failed / can't run / bot error), per-claim reported vs
  reproduced values, whether each value literally appears in the paper, log tail, timings, commit
  SHA, archive SHA-256, image digest, and a `result_hash` over all of it plus the version's content hash.
- **Badge:** "Computationally reproduced" when the latest version's most recent conclusive run matched
  every declared result. Bot errors (infrastructure) never count against a work.
- The manifest is also validated as an integrity check on publication, and in the browser at
  `/tools/reproduce`, so authors see problems before anything runs.

## 5b. ORCID
- OAuth `/authenticate` scope only: Fjournal learns the iD and name, nothing else. The state value is
  a signed, 10-minute cookie scoped to `/auth/orcid`. New iDs pick a handle (a signed 15-minute
  cookie carries the verified iD); accounts created this way have no password.
- One account per verified iD. A verified iD can't be typed over. Self-reported iDs are shown as
  unverified, must pass the ISO 7064 checksum, and can't copy another account's verified iD.
- **Authorship claims** on imported works are checked against the claimant's *public* ORCID works
  (DOI or arXiv ID). Verified authors are treated like owners for conflicts of interest: they can't
  review, endorse, vote on reviews of, or "independently" replicate their work, and moderators can't
  moderate it. Their comments are labelled Author. Claiming earns no reputation.

## 4. Reputation

Reputation is an append-only ledger of `ReputationEvent`s. The score is recomputed from
events, so the algorithm can evolve transparently and be re-run over history.

| Event | Points |
|---|---|
| Your review receives a "helpful" vote | +5 × voter weight |
| Your contribution receives an endorsement | +3 × endorser weight |
| You publish a replication (any outcome) | +15 |
| Your work is independently replicated (reproduced) | +20 |
| You publish a negative result | +10 (same as a positive result — on purpose) |
| You publish any other contribution | +10 |

`voter weight = 1 + log10(1 + voter_reputation)` — established contributors count more,
but a newcomer's vote still counts and the effect is logarithmic so no oligarchy forms.

Anti-gaming (implemented / roadmap):
- No self-votes, no self-endorsements, no self-replication (enforced).
- Rate limits per account (roadmap); sybil resistance via optional ORCID link and
  reputation-weighted signals rather than raw counts (roadmap: graph-based collusion detection).

## 5. Identity
- Handle + password (MVP). ORCID OAuth linking (roadmap) to bind existing scholarly identity.
- Affiliation and degrees are optional free-text and never enter any score.

## 6. Interop with open infrastructure (roadmap, in priority order)
1. **ORCID** — sign-in and push works to the author's ORCID record.
2. **DOIs** — mint via DataCite/Zenodo per version, so Fjournal works are citable everywhere.
3. **Git** — artifacts reference a repository URL + commit SHA; future: mirror repos.
4. **arXiv/bioRxiv import** — one-click import of an existing preprint to start receiving review.
5. **OAI-PMH + JSON API** — so indexers, libraries and Google Scholar can harvest everything.
6. **Ledger anchoring** — OpenTimestamps.

## 7. Technical stack
- Next.js (App Router, Server Components, Server Actions), TypeScript, Tailwind.
- PostgreSQL: Neon in production (Vercel Marketplace), any Postgres locally. Plain SQL in
  `src/lib/*` through `all`/`get`/`run`/`tx` in `src/lib/db.ts` (`node-postgres`, with Fluid
  compute's `attachDatabasePool`). `tx()` carries its connection through AsyncLocalStorage and
  takes a transaction-level advisory lock, so chain appends are serialised exactly as SQLite's
  `BEGIN IMMEDIATE` did in the prototype. Schema migrations are versioned in `db.ts`, applied by
  `npm run migrate` on every build over the direct connection. Type-aware lint rules
  (`no-floating-promises`, `no-misused-promises`) make a forgotten `await` a build error.
- Large files (datasets, PDFs) → object storage (roadmap); MVP stores links + checksums.

## 8. Strategy: becoming a structural threat
Features alone don't beat journals; legitimacy does. The product must make the Fjournal
signal *easier to trust* than a journal brand:
1. **Auditable everything** — public ledger, public review, public badge rules, public API.
2. **Citable** — DOIs per version so works enter the citation graph.
3. **Portable evidence for hiring/funding** — a one-page, verifiable scrutiny report per
   researcher, aligned with DORA / CoARA (built: §3h).
4. **Overlay mode** — communities run curated collections (overlay journals) on top of
   Fjournal, so boards and societies can migrate without starting from zero (built: §3g).
5. **Reviewers are the scarce resource** — reward them with visible reputation and
   citable, DOI-bearing reviews.
