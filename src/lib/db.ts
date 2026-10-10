import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Postgres (Neon in production, any Postgres locally). DATABASE_URL is the pooled connection the app
 * uses; migrations prefer DATABASE_URL_UNPOOLED (a direct connection), as Neon recommends.
 *
 * Writes that touch a hash chain run inside tx(), which takes one advisory lock for the whole
 * transaction: writers are serialised, exactly as SQLite's BEGIN IMMEDIATE did before, so two
 * appends can never read the same chain head.
 */

// COUNT(*), SUM() and identity columns come back as int8/numeric strings by default; every value here fits a JS number.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const SCHEMA_LOCK = 7_461_001;
const WRITE_LOCK = 7_461_002;

/** Ordered, append-only schema migrations. Never edit one that has shipped; add a new one. */
const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "initial schema (consolidated from the SQLite prototype's migrations 0–7)",
    sql: /* sql */ `
    CREATE TABLE users (
      id                TEXT PRIMARY KEY,
      handle            TEXT NOT NULL,
      display_name      TEXT NOT NULL,
      password_hash     TEXT NOT NULL,
      bio               TEXT NOT NULL DEFAULT '',
      affiliation       TEXT NOT NULL DEFAULT '',   -- optional, free text, never scored
      orcid             TEXT,
      orcid_verified_at TEXT,                       -- set only by ORCID sign-in, never by typing
      role              TEXT NOT NULL DEFAULT 'member', -- member | moderator
      report_statement  TEXT NOT NULL DEFAULT '',
      report_highlights TEXT NOT NULL DEFAULT '[]',
      created_at        TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_users_handle ON users (lower(handle));
    CREATE UNIQUE INDEX idx_users_orcid_verified ON users (orcid) WHERE orcid_verified_at IS NOT NULL;

    CREATE TABLE sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE contributions (
      id                  TEXT PRIMARY KEY,
      type                TEXT NOT NULL,
      owner_id            TEXT REFERENCES users(id),   -- NULL for imported works
      latest_version      INTEGER NOT NULL DEFAULT 1,
      replication_of      TEXT REFERENCES contributions(id),
      replication_outcome TEXT,
      status              TEXT NOT NULL DEFAULT 'active', -- active | retracted | hidden
      source_kind         TEXT,                        -- arxiv | biorxiv | medrxiv | doi; NULL = published here
      source_id           TEXT,
      imported_by         TEXT REFERENCES users(id),
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX idx_contrib_updated ON contributions (updated_at DESC);
    CREATE INDEX idx_contrib_replication ON contributions (replication_of);
    CREATE INDEX idx_contrib_owner ON contributions (owner_id);
    CREATE UNIQUE INDEX idx_contrib_source ON contributions (source_id) WHERE source_id IS NOT NULL;

    -- Append-only. Never UPDATE or DELETE rows in this table.
    CREATE TABLE versions (
      seq             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      number          INTEGER NOT NULL,
      title           TEXT NOT NULL,
      abstract        TEXT NOT NULL,
      body            TEXT NOT NULL,
      authors         TEXT NOT NULL,            -- JSON array of strings
      license         TEXT NOT NULL,
      artifacts       TEXT NOT NULL,            -- JSON array of {kind,label,url,pin}
      declarations    TEXT,                     -- JSON, part of the content hash
      source          TEXT,                     -- JSON SourceRecord, part of the content hash
      change_note     TEXT NOT NULL DEFAULT '',
      content_hash    TEXT NOT NULL,
      prev_chain_hash TEXT NOT NULL,
      chain_hash      TEXT NOT NULL UNIQUE,
      created_by      TEXT NOT NULL REFERENCES users(id),
      created_at      TEXT NOT NULL,
      UNIQUE (contribution_id, number)
    );

    CREATE TABLE reviews (
      id                  TEXT PRIMARY KEY,
      contribution_id     TEXT NOT NULL REFERENCES contributions(id),
      version_number      INTEGER NOT NULL,
      reviewer_id         TEXT NOT NULL REFERENCES users(id),
      soundness           INTEGER NOT NULL,
      reproducibility     INTEGER NOT NULL,
      clarity             INTEGER NOT NULL,
      significance        INTEGER NOT NULL,
      recommendation      TEXT NOT NULL,
      body                TEXT NOT NULL,
      competing_interests TEXT,                 -- NULL = not asked (legacy), '' = none
      license             TEXT,
      hidden              INTEGER NOT NULL DEFAULT 0,
      doi                 TEXT,
      doi_status          TEXT,                 -- NULL | pending | registered | failed
      doi_error           TEXT,
      doi_requested_at    TEXT,
      created_at          TEXT NOT NULL
    );
    CREATE INDEX idx_reviews_contrib ON reviews (contribution_id);
    CREATE INDEX idx_reviews_reviewer ON reviews (reviewer_id);
    CREATE UNIQUE INDEX idx_reviews_doi ON reviews (doi) WHERE doi IS NOT NULL;

    CREATE TABLE review_votes (
      review_id  TEXT NOT NULL REFERENCES reviews(id),
      voter_id   TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (review_id, voter_id)
    );

    CREATE TABLE endorsements (
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      note            TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL,
      PRIMARY KEY (contribution_id, user_id)
    );

    CREATE TABLE comments (
      id              TEXT PRIMARY KEY,
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      version_number  INTEGER NOT NULL,
      author_id       TEXT NOT NULL REFERENCES users(id),
      body            TEXT NOT NULL,
      hidden          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_comments_contrib ON comments (contribution_id);

    -- Append-only reputation ledger. A user's score is SUM(points).
    CREATE TABLE reputation_events (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      kind       TEXT NOT NULL,
      points     DOUBLE PRECISION NOT NULL,
      ref        TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_rep_user ON reputation_events (user_id);

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
      seq             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      action          TEXT NOT NULL,              -- retract | hide | restore
      target_type     TEXT NOT NULL,
      target_id       TEXT NOT NULL,
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      reason          TEXT NOT NULL,
      explanation     TEXT NOT NULL,
      evidence_url    TEXT NOT NULL DEFAULT '',
      moderator_id    TEXT NOT NULL REFERENCES users(id),
      report_id       TEXT REFERENCES reports(id),
      reverses_seq    BIGINT REFERENCES moderation_actions(seq),
      created_at      TEXT NOT NULL
    );

    CREATE TABLE appeals (
      id           TEXT PRIMARY KEY,
      action_seq   BIGINT NOT NULL REFERENCES moderation_actions(seq),
      appellant_id TEXT NOT NULL REFERENCES users(id),
      statement    TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open',   -- open | upheld | overturned
      resolver_id  TEXT REFERENCES users(id),
      resolution   TEXT,
      created_at   TEXT NOT NULL,
      resolved_at  TEXT
    );

    CREATE TABLE integrity_checks (
      id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      version_seq BIGINT NOT NULL REFERENCES versions(seq),
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL,                  -- pass | info | warn | fail | error
      summary     TEXT NOT NULL,
      details     TEXT NOT NULL,                  -- JSON array of findings
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_checks_version ON integrity_checks (version_seq);

    CREATE TABLE image_fingerprints (
      version_seq     BIGINT NOT NULL REFERENCES versions(seq),
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      url             TEXT NOT NULL,
      sha256          TEXT NOT NULL,
      dhash           TEXT NOT NULL,
      dhash_mirror    TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      PRIMARY KEY (version_seq, url)
    );
    CREATE INDEX idx_img_sha ON image_fingerprints (sha256);

    -- Append-only. Reviews get their own hash chain, verified alongside the version chain.
    CREATE TABLE review_ledger (
      seq             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      review_id       TEXT NOT NULL UNIQUE REFERENCES reviews(id),
      content_hash    TEXT NOT NULL,
      prev_chain_hash TEXT NOT NULL,
      chain_hash      TEXT NOT NULL UNIQUE,
      created_at      TEXT NOT NULL
    );

    CREATE TABLE contribution_authors (
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      orcid           TEXT NOT NULL,
      verified_via    TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      PRIMARY KEY (contribution_id, user_id)
    );

    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE repro_runs (
      id              TEXT PRIMARY KEY,
      version_seq     BIGINT NOT NULL REFERENCES versions(seq),
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      status          TEXT NOT NULL,      -- queued | running | reproduced | mismatch | failed | invalid | error
      summary         TEXT NOT NULL DEFAULT '',
      repo            TEXT,
      commit_sha      TEXT,
      archive_sha256  TEXT,
      image           TEXT,
      image_digest    TEXT,
      manifest        TEXT,
      results         TEXT,
      log             TEXT,
      exit_code       INTEGER,
      setup_seconds   DOUBLE PRECISION,
      run_seconds     DOUBLE PRECISION,
      result_hash     TEXT,
      requested_by    TEXT REFERENCES users(id),
      worker          TEXT,
      created_at      TEXT NOT NULL,
      started_at      TEXT,
      finished_at     TEXT
    );
    CREATE INDEX idx_runs_version ON repro_runs (version_seq);
    CREATE INDEX idx_runs_queue ON repro_runs (status, created_at);

    CREATE TABLE collections (
      id                  TEXT PRIMARY KEY,
      slug                TEXT NOT NULL,
      name                TEXT NOT NULL,
      tagline             TEXT NOT NULL DEFAULT '',
      scope               TEXT NOT NULL,
      policy              TEXT NOT NULL,
      min_reviews         INTEGER NOT NULL,
      accepts_submissions INTEGER NOT NULL DEFAULT 1,
      accent              TEXT NOT NULL,
      continues           TEXT,
      status              TEXT NOT NULL DEFAULT 'active',
      created_by          TEXT NOT NULL REFERENCES users(id),
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_collections_slug ON collections (lower(slug));

    CREATE TABLE collection_members (
      collection_id TEXT NOT NULL REFERENCES collections(id),
      user_id       TEXT NOT NULL REFERENCES users(id),
      role          TEXT NOT NULL,
      status        TEXT NOT NULL,
      invited_by    TEXT REFERENCES users(id),
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      PRIMARY KEY (collection_id, user_id)
    );
    CREATE INDEX idx_members_user ON collection_members (user_id, status);

    CREATE TABLE collection_items (
      collection_id   TEXT NOT NULL REFERENCES collections(id),
      contribution_id TEXT NOT NULL REFERENCES contributions(id),
      status          TEXT NOT NULL,
      version_number  INTEGER NOT NULL,
      submitted_by    TEXT NOT NULL REFERENCES users(id),
      nominated       INTEGER NOT NULL DEFAULT 0,
      note            TEXT NOT NULL DEFAULT '',
      decided_by      TEXT REFERENCES users(id),
      decision_note   TEXT,
      decided_at      TEXT,
      log_seq         BIGINT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (collection_id, contribution_id)
    );
    CREATE INDEX idx_items_contrib ON collection_items (contribution_id, status);

    -- Append-only and hash-chained. Never UPDATE or DELETE rows in this table.
    CREATE TABLE collection_log (
      seq             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      collection_id   TEXT NOT NULL REFERENCES collections(id),
      kind            TEXT NOT NULL,
      actor_id        TEXT NOT NULL REFERENCES users(id),
      subject         TEXT,
      payload         TEXT NOT NULL,
      content_hash    TEXT NOT NULL,
      prev_chain_hash TEXT NOT NULL,
      chain_hash      TEXT NOT NULL UNIQUE,
      created_at      TEXT NOT NULL
    );
    CREATE INDEX idx_clog_collection ON collection_log (collection_id, seq);

    -- Frozen reports. Never UPDATE or DELETE rows in this table.
    CREATE TABLE scrutiny_reports (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      requested_by TEXT NOT NULL REFERENCES users(id),
      years        INTEGER,
      data         TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_reports_user ON scrutiny_reports (user_id, created_at);

    CREATE TABLE index_journals (
      issn       TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      publisher  TEXT NOT NULL,
      issns      TEXT NOT NULL,
      field      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE index_assessments (
      id              TEXT PRIMARY KEY,
      issn            TEXT NOT NULL REFERENCES index_journals(issn),
      method_version  TEXT NOT NULL,
      window_from     TEXT NOT NULL,
      window_until    TEXT NOT NULL,
      sample_target   INTEGER NOT NULL,
      total_articles  INTEGER NOT NULL,
      retracted       INTEGER NOT NULL,
      concerns        INTEGER NOT NULL,
      retraction_days TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'draft', -- draft | published | superseded | withdrawn
      notes           TEXT NOT NULL DEFAULT '',
      created_by      TEXT NOT NULL REFERENCES users(id),
      created_at      TEXT NOT NULL,
      published_by    TEXT REFERENCES users(id),
      published_at    TEXT,
      published_hash  TEXT
    );
    CREATE INDEX idx_assess_issn ON index_assessments (issn, status);

    CREATE TABLE index_articles (
      assessment_id   TEXT NOT NULL REFERENCES index_assessments(id),
      doi             TEXT NOT NULL,
      title           TEXT NOT NULL DEFAULT '',
      issued          TEXT,
      license_url     TEXT,
      cc_license      INTEGER,
      fulltext        TEXT,
      tests           INTEGER NOT NULL DEFAULT 0,
      inconsistent    INTEGER NOT NULL DEFAULT 0,
      gross           INTEGER NOT NULL DEFAULT 0,
      one_tailed      INTEGER NOT NULL DEFAULT 0,
      findings        TEXT NOT NULL DEFAULT '[]',
      data_class      TEXT,
      data_excerpt    TEXT,
      excluded        TEXT NOT NULL DEFAULT '[]',
      error           TEXT,
      PRIMARY KEY (assessment_id, doi)
    );

    CREATE TABLE index_replies (
      id          TEXT PRIMARY KEY,
      issn        TEXT NOT NULL REFERENCES index_journals(issn),
      author_id   TEXT NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL,
      body        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT REFERENCES users(id),
      review_note TEXT,
      created_at  TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE index_corrections (
      id            TEXT PRIMARY KEY,
      assessment_id TEXT NOT NULL REFERENCES index_assessments(id),
      doi           TEXT,
      indicator     TEXT NOT NULL,
      claim         TEXT NOT NULL,
      evidence_url  TEXT NOT NULL DEFAULT '',
      requester_id  TEXT NOT NULL REFERENCES users(id),
      status        TEXT NOT NULL DEFAULT 'open',
      resolution    TEXT,
      resolver_id   TEXT REFERENCES users(id),
      created_at    TEXT NOT NULL,
      resolved_at   TEXT
    );
    CREATE INDEX idx_corr_assessment ON index_corrections (assessment_id, status);
    `,
  },
];

declare global {
  var __fjournalPool: Pool | undefined;
  var __fjournalSchema: Promise<void> | undefined;
}

const store = new AsyncLocalStorage<PoolClient>();

function pool(): Pool {
  if (!globalThis.__fjournalPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set. See README: Database.");
    globalThis.__fjournalPool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 });
    // Lets a Fluid compute instance close idle connections before it is suspended.
    attachDatabasePool(globalThis.__fjournalPool);
  }
  return globalThis.__fjournalPool;
}

/**
 * Applies pending migrations, one process at a time. `npm run migrate` (and the Vercel build) passes
 * useDirect so DDL goes over DATABASE_URL_UNPOOLED; the app itself only ever uses DATABASE_URL, so a
 * process pointed at one database can never migrate another.
 */
export async function migrate(log: (m: string) => void = () => {}, { useDirect = false } = {}) {
  const direct = useDirect ? process.env.DATABASE_URL_UNPOOLED : undefined;
  const p = direct ? new Pool({ connectionString: direct, max: 1 }) : pool();
  const c = await p.connect();
  try {
    await c.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const done = new Set((await c.query<{ id: number }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query("BEGIN");
      try {
        await c.query(m.sql);
        await c.query("INSERT INTO schema_migrations (id, name, applied_at) VALUES ($1, $2, $3)", [m.id, m.name, now()]);
        await c.query("COMMIT");
        log(`Applied migration ${m.id}: ${m.name}`);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => {});
    c.release();
    if (direct) await p.end();
  }
}

/** The schema is ensured once per process before the first query (a no-op after the first deploy). */
function ready(): Promise<void> {
  globalThis.__fjournalSchema ??= migrate().catch((e) => {
    globalThis.__fjournalSchema = undefined;
    throw e;
  });
  return globalThis.__fjournalSchema;
}

/** `?` placeholders (outside quoted strings) become $1, $2… so queries read the same as before. */
export function toPg(sql: string): string {
  let n = 0;
  let out = "";
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += !quoted && ch === "?" ? `$${++n}` : ch;
  }
  return out;
}

export type Param = string | number | null | boolean;

/** Inside a transaction, queries started together (e.g. via Promise.all) take turns on its one connection. */
const queues = new WeakMap<PoolClient, Promise<unknown>>();

async function query<T>(sql: string, params: Param[]) {
  await ready();
  const c = store.getStore();
  if (!c) {
    const r = await pool().query(toPg(sql), params);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }
  const turn = (queues.get(c) ?? Promise.resolve()).then(() => c.query(toPg(sql), params));
  queues.set(c, turn.catch(() => {}));
  const r = await turn;
  return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
}

export async function all<T>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await query<T>(sql, params)).rows;
}

export async function get<T>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await query<T>(sql, params)).rows[0];
}

/** For writes. Use `RETURNING` and read `rows` to get generated values. */
export async function run<T = Record<string, unknown>>(sql: string, ...params: Param[]) {
  return query<T>(sql, params);
}

/**
 * A serialised write transaction. Everything awaited inside `fn` uses the same connection.
 * Nested calls join the outer transaction.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (store.getStore()) return fn();
  await ready();
  const c = await pool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
    const result = await store.run(c, fn);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** For scripts: close the pool so the process can exit. */
export async function closeDb() {
  await globalThis.__fjournalPool?.end();
  globalThis.__fjournalPool = undefined;
  globalThis.__fjournalSchema = undefined;
}

export const now = () => new Date().toISOString();
