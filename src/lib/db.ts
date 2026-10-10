import "server-only";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { GENESIS, REVIEW_CONTENT_SQL, reviewChainHash, reviewContentHash, reviewContentOf, type ReviewContent } from "./hash";

const DB_PATH = process.env.FJOURNAL_DB ?? path.join(process.cwd(), "data", "fjournal.db");

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  handle        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  affiliation   TEXT NOT NULL DEFAULT '',   -- optional, free text, never scored
  orcid         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL,
  owner_id            TEXT NOT NULL REFERENCES users(id),
  latest_version      INTEGER NOT NULL DEFAULT 1,
  replication_of      TEXT REFERENCES contributions(id),
  replication_outcome TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contrib_updated ON contributions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contrib_replication ON contributions(replication_of);

-- Append-only. Never UPDATE or DELETE rows in this table.
-- seq is the global ledger position; chain_hash links every version on the platform.
CREATE TABLE IF NOT EXISTS versions (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id TEXT NOT NULL REFERENCES contributions(id),
  number          INTEGER NOT NULL,
  title           TEXT NOT NULL,
  abstract        TEXT NOT NULL,
  body            TEXT NOT NULL,
  authors         TEXT NOT NULL,            -- JSON array of strings
  license         TEXT NOT NULL,
  artifacts       TEXT NOT NULL,            -- JSON array of {kind,label,url,pin}
  change_note     TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL,
  prev_chain_hash TEXT NOT NULL,
  chain_hash      TEXT NOT NULL UNIQUE,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  UNIQUE (contribution_id, number)
);

CREATE TABLE IF NOT EXISTS reviews (
  id              TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id),
  version_number  INTEGER NOT NULL,
  reviewer_id     TEXT NOT NULL REFERENCES users(id),
  soundness       INTEGER NOT NULL,
  reproducibility INTEGER NOT NULL,
  clarity         INTEGER NOT NULL,
  significance    INTEGER NOT NULL,
  recommendation  TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_contrib ON reviews(contribution_id);

CREATE TABLE IF NOT EXISTS review_votes (
  review_id  TEXT NOT NULL REFERENCES reviews(id),
  voter_id   TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (review_id, voter_id)
);

CREATE TABLE IF NOT EXISTS endorsements (
  contribution_id TEXT NOT NULL REFERENCES contributions(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  PRIMARY KEY (contribution_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id              TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id),
  version_number  INTEGER NOT NULL,
  author_id       TEXT NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- Append-only reputation ledger. A user's score is SUM(points).
CREATE TABLE IF NOT EXISTS reputation_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  points     REAL NOT NULL,
  ref        TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rep_user ON reputation_events(user_id);
`;

/**
 * Ordered, append-only migrations. Index + 1 = PRAGMA user_version after it runs.
 * `rebuild` migrations recreate a table, which SQLite only allows with foreign keys off;
 * integrity is re-verified with foreign_key_check before they commit.
 */
type Migration = string | { rebuild?: true; sql: string; after?: (d: DatabaseSync) => void };
const MIGRATIONS: Migration[] = [
  /* 1: moderation, declarations, integrity checks */ /* sql */ `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';      -- member | moderator
  ALTER TABLE contributions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'; -- active | retracted | hidden
  ALTER TABLE reviews ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE reviews ADD COLUMN competing_interests TEXT;               -- NULL = not asked (legacy), '' = none
  ALTER TABLE comments ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE versions ADD COLUMN declarations TEXT;                      -- JSON, part of the content hash

  CREATE TABLE reports (
    id              TEXT PRIMARY KEY,
    target_type     TEXT NOT NULL,              -- contribution | review | comment
    target_id       TEXT NOT NULL,
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    reporter_id     TEXT NOT NULL REFERENCES users(id),
    reason          TEXT NOT NULL,
    details         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open', -- open | actioned | dismissed
    resolved_by     TEXT REFERENCES users(id),
    resolution_note TEXT,
    created_at      TEXT NOT NULL,
    resolved_at     TEXT
  );

  -- Append-only public log. Never UPDATE or DELETE rows in this table.
  CREATE TABLE moderation_actions (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    action          TEXT NOT NULL,              -- retract | hide | restore
    target_type     TEXT NOT NULL,
    target_id       TEXT NOT NULL,
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    reason          TEXT NOT NULL,
    explanation     TEXT NOT NULL,
    evidence_url    TEXT NOT NULL DEFAULT '',
    moderator_id    TEXT NOT NULL REFERENCES users(id),
    report_id       TEXT REFERENCES reports(id),
    reverses_seq    INTEGER REFERENCES moderation_actions(seq),
    created_at      TEXT NOT NULL
  );

  CREATE TABLE appeals (
    id          TEXT PRIMARY KEY,
    action_seq  INTEGER NOT NULL REFERENCES moderation_actions(seq),
    appellant_id TEXT NOT NULL REFERENCES users(id),
    statement   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open',   -- open | upheld | overturned
    resolver_id TEXT REFERENCES users(id),
    resolution  TEXT,
    created_at  TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE integrity_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    version_seq INTEGER NOT NULL REFERENCES versions(seq),
    kind        TEXT NOT NULL,                  -- statistics | grim | images | artifacts
    status      TEXT NOT NULL,                  -- pass | info | warn | fail | error
    summary     TEXT NOT NULL,
    details     TEXT NOT NULL,                  -- JSON array of findings
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_checks_version ON integrity_checks(version_seq);

  CREATE TABLE image_fingerprints (
    version_seq     INTEGER NOT NULL REFERENCES versions(seq),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    url             TEXT NOT NULL,
    sha256          TEXT NOT NULL,
    dhash           TEXT NOT NULL,              -- 64-bit difference hash, hex
    dhash_mirror    TEXT NOT NULL,              -- dHash of the horizontally mirrored image
    created_at      TEXT NOT NULL,
    PRIMARY KEY (version_seq, url)
  );
  CREATE INDEX idx_img_sha ON image_fingerprints(sha256);
  `,
  /* 2: imported works — reviewable records of papers published elsewhere */ {
    rebuild: true,
    sql: /* sql */ `
    CREATE TABLE contributions_new (
      id                  TEXT PRIMARY KEY,
      type                TEXT NOT NULL,
      owner_id            TEXT REFERENCES users(id),   -- NULL for imported works: their authors aren't members
      latest_version      INTEGER NOT NULL DEFAULT 1,
      replication_of      TEXT REFERENCES contributions(id),
      replication_outcome TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active',
      source_kind         TEXT,                        -- arxiv | biorxiv | medrxiv | doi; NULL = published on Fjournal
      source_id           TEXT,                        -- arXiv id or lower-case DOI
      imported_by         TEXT REFERENCES users(id)
    );
    INSERT INTO contributions_new (id, type, owner_id, latest_version, replication_of, replication_outcome, created_at, updated_at, status)
      SELECT id, type, owner_id, latest_version, replication_of, replication_outcome, created_at, updated_at, status FROM contributions;
    DROP TABLE contributions;
    ALTER TABLE contributions_new RENAME TO contributions;
    CREATE INDEX idx_contrib_updated ON contributions(updated_at DESC);
    CREATE INDEX idx_contrib_replication ON contributions(replication_of);
    CREATE UNIQUE INDEX idx_contrib_source ON contributions(source_id) WHERE source_id IS NOT NULL;

    ALTER TABLE versions ADD COLUMN source TEXT;          -- JSON SourceRecord, part of the content hash
    `,
  },
  /* 3: citable reviews, ORCID identity, verified authorship */ {
    sql: /* sql */ `
    ALTER TABLE users ADD COLUMN orcid_verified_at TEXT;  -- set only by ORCID sign-in, never by typing
    CREATE UNIQUE INDEX idx_users_orcid_verified ON users(orcid) WHERE orcid_verified_at IS NOT NULL;

    ALTER TABLE reviews ADD COLUMN license TEXT;           -- chosen by the reviewer; NULL on older reviews
    ALTER TABLE reviews ADD COLUMN doi TEXT;
    ALTER TABLE reviews ADD COLUMN doi_status TEXT;        -- NULL | pending | registered | failed
    ALTER TABLE reviews ADD COLUMN doi_error TEXT;
    ALTER TABLE reviews ADD COLUMN doi_requested_at TEXT;
    CREATE UNIQUE INDEX idx_reviews_doi ON reviews(doi) WHERE doi IS NOT NULL;

    -- Append-only. Reviews get their own hash chain, verified alongside the version chain.
    CREATE TABLE review_ledger (
      seq             INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id       TEXT NOT NULL UNIQUE REFERENCES reviews(id),
      content_hash    TEXT NOT NULL,
      prev_chain_hash TEXT NOT NULL,
      chain_hash      TEXT NOT NULL UNIQUE,
      created_at      TEXT NOT NULL
    );

    -- People who proved, through their ORCID record, that they wrote a work imported from elsewhere.
    CREATE TABLE contribution_authors (
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      orcid           TEXT NOT NULL,
      verified_via    TEXT NOT NULL,                 -- orcid-works
      created_at      TEXT NOT NULL,
      PRIMARY KEY (contribution_id, user_id)
    );

    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
    // Reviews written before this migration enter the chain now, in the order they were written.
    // The entry time is the real time of entry; each review's own date is inside its hashed content.
    after: (d) => {
      const rows = d.prepare(`${REVIEW_CONTENT_SQL} ORDER BY r.created_at ASC, r.id ASC`).all() as unknown as (ReviewContent & { id: string })[];
      const at = new Date().toISOString();
      let prev = GENESIS;
      const insert = d.prepare(
        "INSERT INTO review_ledger (review_id, content_hash, prev_chain_hash, chain_hash, created_at) VALUES (?,?,?,?,?)",
      );
      for (const r of rows) {
        const content = reviewContentHash(reviewContentOf({ ...r }));
        const chain = reviewChainHash(prev, content, r.id, at);
        insert.run(r.id, content, prev, chain, at);
        prev = chain;
      }
    },
  },
  /* 4: the reproducibility bot */ `
  CREATE TABLE repro_runs (
    id              TEXT PRIMARY KEY,
    version_seq     INTEGER NOT NULL REFERENCES versions(seq),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    status          TEXT NOT NULL,      -- queued | running | reproduced | mismatch | failed | invalid | error
    summary         TEXT NOT NULL DEFAULT '',
    repo            TEXT,               -- owner/name
    commit_sha      TEXT,               -- full SHA actually run
    archive_sha256  TEXT,               -- of the exact source archive that was executed
    image           TEXT,
    image_digest    TEXT,
    manifest        TEXT,               -- fjournal.json as found at the pinned commit
    results         TEXT,               -- JSON OutputResult[]
    log             TEXT,               -- tail of setup and run output
    exit_code       INTEGER,
    setup_seconds   REAL,
    run_seconds     REAL,
    result_hash     TEXT,               -- sha256 over everything above that determines the outcome
    requested_by    TEXT REFERENCES users(id),  -- NULL = queued automatically on publication
    worker          TEXT,
    created_at      TEXT NOT NULL,
    started_at      TEXT,
    finished_at     TEXT
  );
  CREATE INDEX idx_runs_version ON repro_runs(version_seq);
  CREATE INDEX idx_runs_queue ON repro_runs(status, created_at);
  `,
  /* 5: collections — curated spaces run by editorial boards, on top of open publication */ `
  CREATE TABLE collections (
    id                  TEXT PRIMARY KEY,
    slug                TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name                TEXT NOT NULL,
    tagline             TEXT NOT NULL DEFAULT '',
    scope               TEXT NOT NULL,              -- what the collection covers
    policy              TEXT NOT NULL,              -- public selection criteria
    min_reviews         INTEGER NOT NULL,           -- public reviews a work needs before it can be selected
    accepts_submissions INTEGER NOT NULL DEFAULT 1, -- 0 = the board only nominates
    accent              TEXT NOT NULL,
    continues           TEXT,                       -- JSON Lineage: the journal whose board moved here, or NULL
    status              TEXT NOT NULL DEFAULT 'active', -- active | hidden
    created_by          TEXT NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  -- Current state only. Every change is in collection_log, and verifyLedger() checks the two agree.
  CREATE TABLE collection_members (
    collection_id TEXT NOT NULL REFERENCES collections(id),
    user_id       TEXT NOT NULL REFERENCES users(id),
    role          TEXT NOT NULL,                   -- managing | editor
    status        TEXT NOT NULL,                   -- invited | active | declined | left | removed
    invited_by    TEXT REFERENCES users(id),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (collection_id, user_id)
  );
  CREATE INDEX idx_members_user ON collection_members(user_id, status);

  CREATE TABLE collection_items (
    collection_id   TEXT NOT NULL REFERENCES collections(id),
    contribution_id TEXT NOT NULL REFERENCES contributions(id),
    status          TEXT NOT NULL,                 -- submitted | selected | declined | withdrawn | removed
    version_number  INTEGER NOT NULL,              -- submitted, or decided on
    submitted_by    TEXT NOT NULL REFERENCES users(id),
    nominated       INTEGER NOT NULL DEFAULT 0,    -- 1 = proposed by an editor, not by an author
    note            TEXT NOT NULL DEFAULT '',      -- submission or nomination note
    decided_by      TEXT REFERENCES users(id),
    decision_note   TEXT,
    decided_at      TEXT,
    log_seq         INTEGER,                       -- the log entry behind the current status
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (collection_id, contribution_id)
  );
  CREATE INDEX idx_items_contrib ON collection_items(contribution_id, status);

  -- Append-only and hash-chained, like versions and reviews. Never UPDATE or DELETE rows in this table.
  CREATE TABLE collection_log (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_id   TEXT NOT NULL REFERENCES collections(id),
    kind            TEXT NOT NULL,
    actor_id        TEXT NOT NULL REFERENCES users(id),
    subject         TEXT,                          -- a user id (board changes) or a contribution id (decisions)
    payload         TEXT NOT NULL,                 -- JSON
    content_hash    TEXT NOT NULL,
    prev_chain_hash TEXT NOT NULL,
    chain_hash      TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX idx_clog_collection ON collection_log(collection_id, seq);
  `,
  /* 6: researcher scrutiny reports for hiring and funding committees */ `
  ALTER TABLE users ADD COLUMN report_statement TEXT NOT NULL DEFAULT '';   -- self-reported, labelled as such
  ALTER TABLE users ADD COLUMN report_highlights TEXT NOT NULL DEFAULT '[]'; -- JSON: up to 5 contribution ids, in order

  -- Frozen reports: what a committee received, verifiable later. Never UPDATE or DELETE rows in this table.
  CREATE TABLE scrutiny_reports (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    requested_by TEXT NOT NULL REFERENCES users(id),
    years        INTEGER,                         -- NULL = whole record
    data         TEXT NOT NULL,                   -- the ReportData exactly as shown
    content_hash TEXT NOT NULL,                   -- sha256 of canonical JSON of data
    created_at   TEXT NOT NULL
  );
  CREATE INDEX idx_reports_user ON scrutiny_reports(user_id, created_at);
  `,
  /* 7: the Journal Integrity Index — open, sampled, correctable measurements of journals */ `
  CREATE TABLE index_journals (
    issn       TEXT PRIMARY KEY,                   -- the ISSN the journal is tracked under
    title      TEXT NOT NULL,
    publisher  TEXT NOT NULL,
    issns      TEXT NOT NULL,                      -- JSON: every ISSN Crossref lists for it
    field      TEXT NOT NULL,                      -- for field baselines; assigned by the sweeping moderator
    created_at TEXT NOT NULL
  );

  CREATE TABLE index_assessments (
    id              TEXT PRIMARY KEY,
    issn            TEXT NOT NULL REFERENCES index_journals(issn),
    method_version  TEXT NOT NULL,
    window_from     TEXT NOT NULL,                 -- articles published in [from, until]
    window_until    TEXT NOT NULL,
    sample_target   INTEGER NOT NULL,
    total_articles  INTEGER NOT NULL,              -- Crossref count of journal articles in the window
    retracted       INTEGER NOT NULL,              -- of those, retracted since (Crossref, incl. Retraction Watch)
    concerns        INTEGER NOT NULL,              -- of those, with an expression of concern
    retraction_days TEXT NOT NULL,                 -- JSON: days from publication to each retraction notice
    status          TEXT NOT NULL DEFAULT 'draft', -- draft | published | withdrawn
    notes           TEXT NOT NULL DEFAULT '',
    created_by      TEXT NOT NULL REFERENCES users(id),
    created_at      TEXT NOT NULL,
    published_by    TEXT REFERENCES users(id),     -- must differ from created_by
    published_at    TEXT,
    published_hash  TEXT                           -- sha256 of the assessment and its articles as published
  );
  CREATE INDEX idx_assess_issn ON index_assessments(issn, status);

  -- One row per sampled article: every number on a journal page can be traced to these.
  CREATE TABLE index_articles (
    assessment_id   TEXT NOT NULL REFERENCES index_assessments(id),
    doi             TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    issued          TEXT,
    license_url     TEXT,
    cc_license      INTEGER,                       -- NULL = metadata unavailable
    fulltext        TEXT,                          -- where open full text came from; NULL = none found
    tests           INTEGER NOT NULL DEFAULT 0,    -- APA-reported tests recomputed
    inconsistent    INTEGER NOT NULL DEFAULT 0,
    gross           INTEGER NOT NULL DEFAULT 0,    -- inconsistencies that flip significance
    one_tailed      INTEGER NOT NULL DEFAULT 0,    -- matches a one-tailed test: shown, not counted
    findings        TEXT NOT NULL DEFAULT '[]',    -- JSON: every non-passing test, verbatim
    data_class      TEXT,                          -- see DATA_CLASSES; NULL = no full text
    data_excerpt    TEXT,
    excluded        TEXT NOT NULL DEFAULT '[]',    -- JSON: indicators this article was removed from by an accepted correction
    error           TEXT,
    PRIMARY KEY (assessment_id, doi)
  );

  CREATE TABLE index_replies (
    id          TEXT PRIMARY KEY,
    issn        TEXT NOT NULL REFERENCES index_journals(issn),
    author_id   TEXT NOT NULL REFERENCES users(id),
    role        TEXT NOT NULL,                     -- who they say they are, e.g. "Editor-in-chief"
    body        TEXT NOT NULL,                     -- published verbatim
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | published | rejected
    reviewed_by TEXT REFERENCES users(id),
    review_note TEXT,
    created_at  TEXT NOT NULL,
    reviewed_at TEXT
  );

  CREATE TABLE index_corrections (
    id            TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES index_assessments(id),
    doi           TEXT,                            -- NULL = about the journal-level figures
    indicator     TEXT NOT NULL,
    claim         TEXT NOT NULL,
    evidence_url  TEXT NOT NULL DEFAULT '',
    requester_id  TEXT NOT NULL REFERENCES users(id),
    status        TEXT NOT NULL DEFAULT 'open',    -- open | accepted | rejected
    resolution    TEXT,
    resolver_id   TEXT REFERENCES users(id),
    created_at    TEXT NOT NULL,
    resolved_at   TEXT
  );
  CREATE INDEX idx_corr_assessment ON index_corrections(assessment_id, status);
  `,
];

declare global {
  var __fjournalDb: DatabaseSync | undefined;
}

function migrate(d: DatabaseSync) {
  const current = Number((d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let i = current; i < MIGRATIONS.length; i++) {
    const m = MIGRATIONS[i];
    const rebuild = typeof m !== "string" && !!m.rebuild;
    if (rebuild) d.exec("PRAGMA foreign_keys = OFF"); // a no-op inside a transaction, so set it first
    d.exec("BEGIN IMMEDIATE");
    try {
      d.exec(typeof m === "string" ? m : m.sql);
      if (typeof m !== "string") m.after?.(d);
      if (rebuild && d.prepare("PRAGMA foreign_key_check").all().length > 0)
        throw new Error(`Migration ${i + 1} would break foreign keys.`);
      d.exec(`PRAGMA user_version = ${i + 1}`);
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    } finally {
      if (rebuild) d.exec("PRAGMA foreign_keys = ON");
    }
  }
}

function open(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  d.exec(SCHEMA);
  migrate(d);
  return d;
}

export function db(): DatabaseSync {
  globalThis.__fjournalDb ??= open();
  return globalThis.__fjournalDb;
}

// node:sqlite returns null-prototype objects; React Server Components need plain objects.
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db().prepare(sql).all(...params).map((r) => ({ ...r }) as T);
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  const r = db().prepare(sql).get(...params);
  return r ? ({ ...r } as T) : undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db().prepare(sql).run(...params);
}

/** Serialised write transaction (BEGIN IMMEDIATE takes the write lock up front). */
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export const now = () => new Date().toISOString();
