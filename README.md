# Fjournal

**Science, judged in the open.** An open scientific publishing platform built to replace the
journal system: publish right away, keep your copyright, get evaluated in public by the whole
community, and earn reputation through the quality of what you contribute. Zero fees, forever.

Start with [`docs/MANIFESTO.md`](docs/MANIFESTO.md): **why** we are building this matters as much as the code.
Every design decision must serve it. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) shows how the build carries it out.

## Quick start

Requires Node.js 22.5+ (uses the built-in `node:sqlite`; no database server needed).

```bash
npm install
npm run seed     # optional: demo users + contributions (password: fjournal-demo)
npm run dev      # http://localhost:3000
```

The database lives in `./data/fjournal.db`. Delete `./data` to start over. Set `FJOURNAL_DB`
to use a different path.

## What's in the MVP

| Feature | Where |
|---|---|
| Publish immediately: 8 contribution types, including **replication** and **negative result** | `/submit` |
| Markdown + LaTeX math, linked data/code/notebooks pinned to a commit, DOI or checksum | contribution form |
| One-click licensing (CC BY default, CC BY-SA, CC BY-NC, CC0, All Rights Reserved). Authors keep copyright | contribution form |
| Immutable versions with "what changed" notes. Old versions and their reviews stay public | `/c/[id]?v=n`, `/c/[id]/edit` |
| **Platform-wide hash chain** of every version, re-verified on view, exportable, with per-version priority receipts | `/ledger`, `/api/ledger`, `/c/[id]/v/[n]/receipt` |
| Open, signed reviews on a 4-axis rubric, attached to a specific version, 200-character minimum | contribution page |
| "Helpful" votes on reviews: the only way reviewers earn reputation | contribution page |
| Endorsements, discussion, independent replications shown on the original | contribution page |
| Scrutiny record + public badge rules (Open / Scrutinized / Replicated / Contested) | sidebar, `/about#badges` |
| Append-only reputation ledger with log-weighted votes, plus a per-person "scrutiny report" | `/u/[handle]` |
| No credential gate: affiliation and ORCID are optional and never scored | `/signup`, `/settings` |
| Open read API | `/api/contributions` |
| **Funding & competing-interest declarations** on every version (hashed into the ledger) and on every review | contribution form, review form |
| **Automated integrity checks** on every version: p-value recomputation (statcheck method), GRIM, figure duplication incl. mirrored copies, data/code pin verification | contribution page, `/tools/check` |
| **Public moderation log**: fraud/plagiarism/abuse only, named moderators, evidence required, appeals decided by a different moderator | `/moderation` |
| **Journal Integrity Index** (off until `FJOURNAL_INDEX_PUBLIC=1`): sampled, open measurements of journals — statistical-reporting inconsistencies, data availability, open licensing, retractions and time to retraction — each with a 95% Wilson interval, a minimum sample and a field baseline; no composite score, no ranking; every figure traced to the sampled articles; sweeps by one moderator, publication by another; journals' right of reply; public corrections. The method page is public from day one | `/journals`, `/journals/method`, `/journals/review`, `npm run index`, `/api/journals` |
| **Scrutiny reports** for hiring and funding committees: one printable A4 page per researcher, showing how their work held up (public reviews, replications incl. failed ones, open data/code, bot re-runs, integrity checks, revision after review), their reviewing, replications and editorial service, and every retraction. The researcher adds only a short statement (labelled self-reported) and up to 5 works to be judged on. No single score, impact factor, citation count or venue prestige (DORA/CoARA). Freeze a copy for a permanent link + SHA-256 anyone can recheck | `/u/<handle>/report`, `/report/<id>`, `/api/researchers/<handle>/report`, `/api/reports/<id>` |
| **Collections** for editorial boards: a branded home with scope, public selection criteria and a minimum of public reviews; invite-and-accept boards with ORCID marks; signed, reasoned, COI-declared decisions pinned to the exact version and policy; author submissions and editor nominations (any arXiv/DOI paper); optional lineage claim with evidence; a fourth hash chain, with the current state checked against it | `/collections`, `/j/<slug>`, `/j/<slug>/desk`, `/j/<slug>/log`, `/api/collections` |
| **Reproducibility bot**: re-runs pinned GitHub code from `fjournal.json` in a Docker sandbox (no network during the run, unprivileged, resource-limited) and checks every declared result; "Computationally reproduced" badge | contribution page, `/tools/reproduce`, `npm run worker` |
| **Citable reviews**: every review has a permanent page, its own hash chain, a reviewer-chosen license, BibTeX/RIS/CSL-JSON, Google Scholar tags and an optional DataCite DOI (type PeerReview, "Reviews" the work, carries the verified ORCID) | `/r/<id>`, `/u/<handle>/reviews` |
| **ORCID**: sign in / sign up, connect to an existing account, and claim imported papers listed on your ORCID record. Verified authors can't review, endorse or vote on their own work | `/login`, `/settings` |
| **Review any paper**: import from arXiv, bioRxiv/medRxiv, any Crossref DOI or DataCite DOI; open review, replications and statistics checks on the open full text; publisher retractions surfaced | `/import` |

Integrity rules are enforced on the server: no self-review, self-endorsement, self-replication,
or voting on your own review. Moderators can't act on anything attached to their own work, and
"disagreement" is not a moderation reason anywhere in the code.

### Moderators

The demo seed makes `lin` and `noor` moderators. Manage roles with:

```bash
npm run moderator -- <handle>            # grant
npm run moderator -- <handle> --revoke   # revoke
```

At least two moderators are needed, because an appeal must be decided by someone other than
the moderator who acted.

Set `GITHUB_TOKEN` to raise the GitHub API rate limit used to verify pinned commits.
### Reproducibility worker (optional)

The web app never runs anyone's code. A separate worker does, inside Docker:

```bash
npm run sandbox:selftest                       # prove this host isolates code (network, user, symlinks, timeouts)
FJOURNAL_REPRO_ENABLED=1 npm run worker        # set FJOURNAL_REPRO_ENABLED=1 on the web app too
```

Run it on a **dedicated machine or VM**, not the web server: the setup phase (installing
dependencies) has network access, so put the worker behind an egress firewall that blocks private
address ranges. Set `FJOURNAL_SANDBOX_RUNTIME=runsc` to use gVisor for kernel-level isolation.
The worker shares the database with the web app (a hosted Postgres in production; see roadmap).

### Journal Integrity Index (off by default)

Results stay private (moderators can preview) until `FJOURNAL_INDEX_PUBLIC=1`. Before switching it on, have the
method at `/journals/method` reviewed by research-integrity (metascience) researchers and the publication checked by a
lawyer. Measuring a journal:

```bash
FJOURNAL_CONTACT_EMAIL=you@example.org npm run index -- sweep 1932-6203 --field "Multidisciplinary" \
  --from 2019-01-01 --until 2020-12-31 --sample 200 --by <moderator>
```

The sweep is paced for Crossref's public API (a 200-article sample takes a few minutes) and saves a draft; a
**different** moderator publishes it at `/journals/review`.

### ORCID and DOIs (optional — everything else works without them)

| Variable | Purpose |
|---|---|
| `FJOURNAL_PUBLIC_URL` | Public base URL, e.g. `https://fjournal.org`. Needed for DOIs and ORCID redirects. |
| `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET` | From https://orcid.org/developer-tools (free public API). Redirect URI: `<public url>/auth/orcid/callback`. |
| `ORCID_BASE`, `ORCID_API_BASE` | Default `https://orcid.org` / `https://pub.orcid.org`. Use `https://sandbox.orcid.org` / `https://pub.sandbox.orcid.org` to test. |
| `DATACITE_REPOSITORY_ID`, `DATACITE_PASSWORD`, `DATACITE_PREFIX` | A DataCite repository account (via a DataCite member or consortium). |
| `DATACITE_API` | Defaults to the **test** service `https://api.test.datacite.org`. Set `https://api.datacite.org` only for real DOIs; findable DOIs can never be deleted. |
| `FJOURNAL_SECRET` | Optional signing key for short-lived cookies; otherwise one is generated and kept in the database. |

Set `FJOURNAL_CONTACT_EMAIL` to identify the deployment to Crossref (its "polite pool" is faster
and more reliable). The demo seed imports four real papers when it has network access.

## Roadmap (next priorities)

1. Postgres (Neon) + object storage, so it can be deployed on serverless infrastructure.
2. DOIs per version of work published here (the DataCite plumbing for reviews is in place).
3. Pushing reviews to ORCID's peer-review section (needs ORCID member API).
4. Anchor the ledger head to OpenTimestamps.
5. OAI-PMH for indexers; verified author claims of imported works (needs ORCID); figure fingerprinting
   for imported works; bulk "scrutiny sweeps" of open-access corpora.
6. Collections: moderation of collections (impersonation reports), notifications to boards and authors,
   and DOIs for selections.
7. Anti-sybil and collusion detection for reputation; rate limits.
8. Moderators elected by high-reputation members, with term limits; reporter identity protection.
9. Integrity: a background job queue for checks, an image similarity index (BK-tree) as the corpus grows,
   and more checks (SPRITE, Benford, duplicated table rows).
