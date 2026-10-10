"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  actOnReport,
  addComment,
  appealAction,
  claimAuthorshipAction,
  createVersion,
  dismissReportAction,
  endorse,
  freezeReportAction,
  importPaper,
  saveReportSettingsAction,
  refreshImport,
  reportContent,
  requestReproduction,
  requestReviewDoi,
  signupWithOrcid,
  resolveAppealAction,
  login,
  signup,
  submitContribution,
  submitReview,
  updateProfile,
  type FormState,
} from "@/app/actions";
import {
  ARTIFACT_KINDS,
  AUTHOR_LICENSES,
  CONTRIBUTION_TYPES,
  DEFAULT_LICENSE,
  LICENSES,
  MODERATION_REASONS,
  RECOMMENDATIONS,
  REPLICATION_OUTCOMES,
  RUBRIC,
  type ContributionType,
  type Declarations,
  type Funding,
  type License,
  type ModerationReason,
  type ModerationTarget,
} from "@/lib/constants";
import type { Artifact } from "@/lib/ledger";
import { Markdown } from "./Markdown";

export function Submit({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function ErrorNote({ state }: { state: FormState }) {
  if (state?.ok)
    return (
      <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
        {state.ok}
      </p>
    );
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
      {state.error}
    </p>
  );
}

// ───────────────────────────── Accounts ─────────────────────────────

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <div>
        <label className="label" htmlFor="handle">Handle</label>
        <input className="input" id="handle" name="handle" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <ErrorNote state={state} />
      <Submit className="btn w-full">Sign in</Submit>
    </form>
  );
}

export function SignupForm() {
  const [state, action] = useActionState(signup, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="handle">Handle</label>
        <input className="input" id="handle" name="handle" pattern="[a-zA-Z0-9_\-]{3,32}" required placeholder="ada_l" />
        <p className="hint">Your public, permanent identity on Fjournal.</p>
      </div>
      <div>
        <label className="label" htmlFor="display_name">Name</label>
        <input className="input" id="display_name" name="display_name" required placeholder="Ada Lovelace" />
      </div>
      <div>
        <label className="label" htmlFor="affiliation">Affiliation <span className="font-normal text-muted">(optional)</span></label>
        <input className="input" id="affiliation" name="affiliation" placeholder="Independent researcher" />
        <p className="hint">Never required, never scored. Your work speaks for you.</p>
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" minLength={10} autoComplete="new-password" required />
      </div>
      <ErrorNote state={state} />
      <Submit className="btn w-full">Create account</Submit>
    </form>
  );
}

export function ProfileForm({ user }: { user: { display_name: string; bio: string; affiliation: string; orcid: string | null; orcid_verified_at: string | null } }) {
  const [state, action] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="display_name">Name</label>
        <input className="input" id="display_name" name="display_name" defaultValue={user.display_name} required />
      </div>
      <div>
        <label className="label" htmlFor="affiliation">Affiliation <span className="font-normal text-muted">(optional)</span></label>
        <input className="input" id="affiliation" name="affiliation" defaultValue={user.affiliation} />
      </div>
      {!user.orcid_verified_at && (
        <div>
          <label className="label" htmlFor="orcid">ORCID iD <span className="font-normal text-muted">(optional, self-reported)</span></label>
          <input className="input font-mono" id="orcid" name="orcid" defaultValue={user.orcid ?? ""} placeholder="0000-0002-1825-0097" />
          <p className="hint">Shown as unverified. Connect ORCID above to verify it and have it attached to your review DOIs.</p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="bio">About you</label>
        <textarea className="input min-h-28" id="bio" name="bio" defaultValue={user.bio} />
      </div>
      <ErrorNote state={state} />
      <Submit>Save profile</Submit>
    </form>
  );
}

export function OrcidSignupForm({ name }: { name: string }) {
  const [state, action] = useActionState(signupWithOrcid, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="handle">Handle</label>
        <input className="input" id="handle" name="handle" pattern="[a-zA-Z0-9_\-]{3,32}" required placeholder="ada_l" />
        <p className="hint">Your public, permanent identity on Fjournal.</p>
      </div>
      <div>
        <label className="label" htmlFor="display_name">Name</label>
        <input className="input" id="display_name" name="display_name" required defaultValue={name} />
      </div>
      <div>
        <label className="label" htmlFor="affiliation">Affiliation <span className="font-normal text-muted">(optional)</span></label>
        <input className="input" id="affiliation" name="affiliation" placeholder="Independent researcher" />
        <p className="hint">Never required, never scored.</p>
      </div>
      <ErrorNote state={state} />
      <Submit className="btn w-full">Create account</Submit>
    </form>
  );
}

// ─────────────────────────── Citable reviews & authorship ───────────────────────────

export function RequestDoiForm({ reviewId, retry }: { reviewId: string; retry?: boolean }) {
  const [state, action] = useActionState(requestReviewDoi, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="review_id" value={reviewId} />
      <Submit className="btn">{retry ? "Retry DOI registration" : "Register a DOI for this review"}</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

export function ClaimAuthorshipForm({ contributionId }: { contributionId: string }) {
  const [state, action] = useActionState(claimAuthorshipAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contribution_id" value={contributionId} />
      <Submit className="btn-ghost w-full">I&apos;m an author: verify with ORCID</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

export function RequestReproductionForm({ contributionId, versionNumber }: { contributionId: string; versionNumber: number }) {
  const [state, action] = useActionState(requestReproduction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contribution_id" value={contributionId} />
      <input type="hidden" name="version_number" value={versionNumber} />
      <Submit className="btn-ghost">Run the code again</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

// ─────────────────────────── Scrutiny reports ───────────────────────────

export function FreezeReportForm({ handle, years }: { handle: string; years: number | null }) {
  const [state, action] = useActionState(freezeReportAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="handle" value={handle} />
      <input type="hidden" name="years" value={years ?? ""} />
      <Submit className="btn-ghost">Freeze a verifiable copy</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

export function ReportSettingsForm({
  statement,
  highlights,
  works,
}: {
  statement: string;
  highlights: string[];
  works: { id: string; title: string; type: string }[];
}) {
  const [state, action] = useActionState(saveReportSettingsAction, undefined);
  const [len, setLen] = useState(statement.length);
  const [picked, setPicked] = useState<string[]>(highlights);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="statement">Your statement <span className="font-normal text-muted">(optional)</span></label>
        <textarea
          className="input min-h-28"
          id="statement"
          name="statement"
          defaultValue={statement}
          maxLength={800}
          onChange={(e) => setLen(e.target.value.length)}
          placeholder="What you work on, what you are proudest of and why, and anything a committee should know (a career break, a long-term dataset, teaching, software others rely on)."
        />
        <p className="hint">{len}/800 · Shown on your report as self-reported, in your own words.</p>
      </div>
      <fieldset className="space-y-1">
        <legend className="label">Works to be judged on <span className="font-normal text-muted">(up to 5)</span></legend>
        {works.length === 0 && <p className="text-sm text-muted">Publish work, or claim imported papers through ORCID, to highlight it here.</p>}
        {works.map((w) => (
          <label key={w.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="highlight"
              value={w.id}
              className="mt-1"
              checked={picked.includes(w.id)}
              disabled={!picked.includes(w.id) && picked.length >= 5}
              onChange={(e) => setPicked(e.target.checked ? [...picked, w.id] : picked.filter((x) => x !== w.id))}
            />
            <span>{w.title}</span>
          </label>
        ))}
        <p className="hint">Each is shown with all of its evidence, good and bad. If you choose none, your most scrutinized works are shown.</p>
      </fieldset>
      <ErrorNote state={state} />
      <Submit>Save report settings</Submit>
    </form>
  );
}

// ─────────────────────────── Imported works ───────────────────────────

export function ImportForm({ initial }: { initial?: string }) {
  const [state, action] = useActionState(importPaper, undefined);
  return (
    <form action={action} className="space-y-3">
      <label className="label" htmlFor="identifier">arXiv ID, DOI, or link</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="input font-mono"
          id="identifier"
          name="identifier"
          defaultValue={initial}
          required
          placeholder="2310.06825 · 10.1126/science.aac4716 · https://www.biorxiv.org/content/…"
        />
        <Submit className="btn shrink-0">Open for review</Submit>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function RefreshSourceForm({ contributionId }: { contributionId: string }) {
  const [state, action] = useActionState(refreshImport, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contribution_id" value={contributionId} />
      <Submit className="btn-ghost w-full">Check the source for a newer version</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

// ─────────────────────────── Contributions ───────────────────────────

export type ContributionInitial = {
  title: string;
  abstract: string;
  body: string;
  authors: string[];
  license: License;
  artifacts: Artifact[];
  declarations: Declarations | null;
};

const EMPTY_ARTIFACT: Artifact = { kind: "data", label: "", url: "", pin: "" };

export function ContributionForm({
  mode,
  contributionId,
  initial,
  replicationOf,
  defaultAuthor,
}: {
  mode: "new" | "version";
  contributionId?: string;
  initial?: ContributionInitial;
  replicationOf?: string;
  defaultAuthor: string;
}) {
  const [state, action] = useActionState(mode === "new" ? submitContribution : createVersion, undefined);
  const [type, setType] = useState<ContributionType>(replicationOf ? "replication" : "research");
  const [license, setLicense] = useState<License>(initial?.license ?? DEFAULT_LICENSE);
  const [artifacts, setArtifacts] = useState<Artifact[]>(
    initial?.artifacts.length ? initial.artifacts : [EMPTY_ARTIFACT, { ...EMPTY_ARTIFACT, kind: "code" }],
  );
  const [body, setBody] = useState(initial?.body ?? "");
  const [funding, setFunding] = useState<Funding[]>(
    initial?.declarations?.funding.length ? initial.declarations.funding : [{ funder: "", grant: "" }],
  );
  // Prefilled from the previous version on edits; legacy versions without declarations start blank.
  const [coiMode, setCoiMode] = useState<"" | "none" | "declare">(
    initial?.declarations ? (initial.declarations.competing_interests ? "declare" : "none") : "",
  );
  const [preview, setPreview] = useState(false);

  return (
    <form action={action} className="space-y-8">
      {contributionId && <input type="hidden" name="contribution_id" value={contributionId} />}

      {mode === "new" && (
        <section className="space-y-3">
          <h2 className="font-serif text-lg font-semibold">What are you contributing?</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(CONTRIBUTION_TYPES) as ContributionType[]).map((t) => (
              <label
                key={t}
                className={`card cursor-pointer p-3 text-sm transition ${type === t ? "border-accent ring-2 ring-accent/20" : "hover:border-ink/30"}`}
              >
                <input type="radio" name="type" value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
                <span className="block font-semibold">{CONTRIBUTION_TYPES[t].label}</span>
                <span className="text-xs text-muted">{CONTRIBUTION_TYPES[t].hint}</span>
              </label>
            ))}
          </div>
          {type === "replication" && (
            <div className="card grid gap-4 border-violet-500/40 p-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="replication_of">Contribution you replicated</label>
                <input className="input font-mono" id="replication_of" name="replication_of" defaultValue={replicationOf} placeholder="2026.k3x9qa or its URL" required />
              </div>
              <div>
                <label className="label" htmlFor="replication_outcome">Outcome</label>
                <select className="input" id="replication_outcome" name="replication_outcome" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {Object.entries(REPLICATION_OUTCOMES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <p className="hint sm:col-span-2">Every outcome is valuable. Failed replications are shown prominently on the original work.</p>
            </div>
          )}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold">The work</h2>
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input className="input text-base" id="title" name="title" defaultValue={initial?.title} required maxLength={300} />
        </div>
        <div>
          <label className="label" htmlFor="authors">Authors</label>
          <textarea
            className="input min-h-16"
            id="authors"
            name="authors"
            defaultValue={(initial?.authors ?? [defaultAuthor]).join("\n")}
            placeholder="One per line"
          />
          <p className="hint">One per line. Order and credit are yours to decide.</p>
        </div>
        <div>
          <label className="label" htmlFor="abstract">Abstract</label>
          <textarea className="input min-h-28" id="abstract" name="abstract" defaultValue={initial?.abstract} required maxLength={5000} />
          <p className="hint">State what you did, what you found, and how sure you are. No need to oversell.</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0" htmlFor="body">Full text <span className="font-normal text-muted">(Markdown + LaTeX math)</span></label>
            <button type="button" className="text-xs text-accent" onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview"}
            </button>
          </div>
          {preview ? (
            <div className="card min-h-64 p-5">{body ? <Markdown>{body}</Markdown> : <p className="text-sm text-muted">Nothing to preview.</p>}</div>
          ) : null}
          <textarea
            className={`input min-h-96 font-mono text-[13px] leading-6 ${preview ? "hidden" : ""}`}
            id="body"
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"## Methods\n\nWe measured $E = mc^2$ by…\n\n## Results\n\n## Limitations"}
          />
          <p className="hint">No templates, no formatting theatre. Write it the way it should be read.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold">Data, code & notebooks</h2>
        <p className="text-sm text-muted">
          Link the materials someone needs to check or reproduce this. Pin a commit SHA, DOI, or checksum so the exact
          version is recorded in the immutable ledger. Data + code earns the <strong>Open</strong> badge.
        </p>
        <div className="space-y-2">
          {artifacts.map((a, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[120px_1fr_2fr_1fr_auto]">
              <select className="input" name="artifact_kind" defaultValue={a.kind} aria-label="Kind">
                {ARTIFACT_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <input className="input" name="artifact_label" defaultValue={a.label} placeholder="Label" aria-label="Label" />
              <input className="input" name="artifact_url" defaultValue={a.url} placeholder="https://github.com/… or https://zenodo.org/…" aria-label="URL" />
              <input className="input font-mono" name="artifact_pin" defaultValue={a.pin} placeholder="commit / DOI / sha256" aria-label="Pin" />
              <button type="button" className="btn-ghost" onClick={() => setArtifacts(artifacts.filter((_, j) => j !== i))} aria-label="Remove artifact">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={() => setArtifacts([...artifacts, { ...EMPTY_ARTIFACT, kind: "other" }])}>
          + Add artifact
        </button>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold">Funding & competing interests</h2>
        <p className="text-sm text-muted">
          Readers deserve to know who paid for the work and who might gain from its conclusions. Declarations are part
          of this version&apos;s permanent, hashed record.
        </p>
        <div className="space-y-2">
          <span className="label">Funding sources</span>
          {funding.map((f, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
              <input className="input" name="funding_funder" defaultValue={f.funder} placeholder="Funder, e.g. National Science Foundation" aria-label="Funder" />
              <input className="input font-mono" name="funding_grant" defaultValue={f.grant} placeholder="Grant number" aria-label="Grant number" />
              <button type="button" className="btn-ghost" onClick={() => setFunding(funding.filter((_, j) => j !== i))} aria-label="Remove funder">
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setFunding([...funding, { funder: "", grant: "" }])}>
            + Add funder
          </button>
          <p className="hint">Leave empty if the work had no specific funding. Self-funded work is welcome here.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="label">Competing interests</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="coi_mode" value="none" required checked={coiMode === "none"} onChange={() => setCoiMode("none")} className="mt-1" />
            <span>The authors have no competing interests to declare.</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="coi_mode" value="declare" checked={coiMode === "declare"} onChange={() => setCoiMode("declare")} className="mt-1" />
            <span>The authors have competing interests to declare (financial, employment, patents, personal, advocacy...).</span>
          </label>
          {coiMode === "declare" && (
            <textarea
              className="input min-h-20"
              name="coi_text"
              required
              defaultValue={initial?.declarations?.competing_interests}
              placeholder="e.g. A.O. consults for Acme Biotech, which sells the assay evaluated here."
            />
          )}
        </fieldset>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-lg font-semibold">Your rights</h2>
        <p className="text-sm text-muted">
          You keep the copyright. Fjournal only hosts and displays your work. Pick how others may reuse it:
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {AUTHOR_LICENSES.map((l) => (
            <label
              key={l}
              className={`card cursor-pointer p-3 text-sm transition ${license === l ? "border-accent ring-2 ring-accent/20" : "hover:border-ink/30"}`}
            >
              <input type="radio" name="license" value={l} checked={license === l} onChange={() => setLicense(l)} className="sr-only" />
              <span className="block font-semibold">
                {LICENSES[l].label} {l === DEFAULT_LICENSE && <span className="ml-1 text-xs font-normal text-accent">recommended</span>}
              </span>
              <span className="text-xs text-muted">{LICENSES[l].summary}</span>
            </label>
          ))}
        </div>
      </section>

      {mode === "version" && (
        <section>
          <label className="label" htmlFor="change_note">What changed in this version?</label>
          <textarea
            className="input min-h-20"
            id="change_note"
            name="change_note"
            required
            placeholder="Addressed review by @x: re-ran analysis with corrected baseline; added raw data."
          />
          <p className="hint">Earlier versions and their reviews stay public forever. Credit the reviewers who helped.</p>
        </section>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <ErrorNote state={state} />
        <div className="flex items-center gap-4">
          <Submit>{mode === "new" ? "Publish now" : "Publish new version"}</Submit>
          <p className="text-xs text-muted">
            Published immediately and timestamped in the public ledger. This is your proof of priority.
          </p>
        </div>
      </div>
    </form>
  );
}

// ───────────────────────────── Evaluation ─────────────────────────────

export function ReviewForm({ contributionId, versionNumber }: { contributionId: string; versionNumber: number }) {
  const [state, action] = useActionState(submitReview, undefined);
  const [len, setLen] = useState(0);
  const [coi, setCoi] = useState("");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="contribution_id" value={contributionId} />
      <input type="hidden" name="version_number" value={versionNumber} />
      <div className="grid gap-3 sm:grid-cols-4">
        {RUBRIC.map((k) => (
          <div key={k}>
            <label className="label capitalize" htmlFor={k}>{k}</label>
            <select className="input" id={k} name={k} required defaultValue="">
              <option value="" disabled>–</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="body">Your review (public, signed, permanent)</label>
        <textarea
          className="input min-h-48"
          id="body"
          name="body"
          required
          onChange={(e) => setLen(e.target.value.trim().length)}
          placeholder={"What is the claim? Do the methods and data support it?\nWhat would you need to see to be convinced? Concrete, fixable suggestions are the most valuable."}
        />
        <p className={`hint ${len > 0 && len < 200 ? "text-amber-600" : ""}`}>
          {len}/200 minimum characters · Markdown supported · Reviews are attached to version {versionNumber}.
        </p>
      </div>
      <fieldset className="space-y-1">
        <legend className="label">Your competing interests</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="coi_mode" value="none" required checked={coi === "none"} onChange={() => setCoi("none")} className="mt-1" />
          <span>I have no competing interests with the authors or this work.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="coi_mode" value="declare" checked={coi === "declare"} onChange={() => setCoi("declare")} className="mt-1" />
          <span>I have something to declare: a collaborator, rival, same institution, shared funder, or a stake in the outcome.</span>
        </label>
        {coi === "declare" && <input className="input" name="coi_text" required placeholder="e.g. I co-authored a paper with the second author in 2023." />}
        <p className="hint">Declaring an interest doesn&apos;t disqualify you. It lets readers weigh your review fairly.</p>
      </fieldset>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label" htmlFor="review_license">License for your review</label>
          <select className="input" id="review_license" name="license" defaultValue={DEFAULT_LICENSE}>
            {AUTHOR_LICENSES.map((l) => (
              <option key={l} value={l}>{LICENSES[l].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="recommendation">Overall</label>
          <select className="input" id="recommendation" name="recommendation" required defaultValue="">
            <option value="" disabled>Choose…</option>
            {Object.entries(RECOMMENDATIONS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <Submit>Publish review</Submit>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function EndorseForm({ contributionId }: { contributionId: string }) {
  const [state, action] = useActionState(endorse, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contribution_id" value={contributionId} />
      <input className="input" name="note" placeholder="Optional: what did you check?" maxLength={1000} />
      <Submit className="btn-ghost w-full">Endorse this work</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

export function CommentForm({ contributionId, versionNumber }: { contributionId: string; versionNumber: number }) {
  const [state, action] = useActionState(addComment, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contribution_id" value={contributionId} />
      <input type="hidden" name="version_number" value={versionNumber} />
      <textarea className="input min-h-20" name="body" required placeholder="Ask a question, suggest an improvement, point to related work…" />
      <div className="flex justify-end">
        <Submit className="btn-ghost">Post comment</Submit>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

// ───────────────────────────── Moderation ─────────────────────────────

export function ReportForm({ targetType, targetId }: { targetType: ModerationTarget; targetId: string }) {
  const [state, action] = useActionState(reportContent, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer list-none hover:text-ink">⚑ Report</summary>
      <form action={action} className="mt-3 space-y-2 rounded-md border border-line bg-paper p-3 text-sm text-ink">
        <input type="hidden" name="target_type" value={targetType} />
        <input type="hidden" name="target_id" value={targetId} />
        <p className="text-xs text-muted">
          Reports are only for fraud, plagiarism or abuse. <strong>Disagreeing with the work is not a reason</strong>.
          Write a review or a replication instead.
        </p>
        <select className="input" name="reason" required defaultValue="">
          <option value="" disabled>Reason...</option>
          {(Object.keys(MODERATION_REASONS) as ModerationReason[]).map((k) => (
            <option key={k} value={k}>{MODERATION_REASONS[k].label}</option>
          ))}
        </select>
        <textarea className="input min-h-20" name="details" required minLength={30} placeholder="What exactly is wrong, and where is the evidence? (links, figure numbers, the original source...)" />
        <Submit className="btn-ghost">Send report</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}

export function ModerateReportForm({ reportId, defaultReason, targetType }: { reportId: string; defaultReason: ModerationReason; targetType: ModerationTarget }) {
  const [state, action] = useActionState(actOnReport, undefined);
  const [dState, dismiss] = useActionState(dismissReportAction, undefined);
  const [reason, setReason] = useState<ModerationReason>(defaultReason);
  const effect = targetType === "contribution" ? MODERATION_REASONS[reason].action : "hide";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form action={action} className="space-y-2">
        <input type="hidden" name="report_id" value={reportId} />
        <select className="input" name="reason" value={reason} onChange={(e) => setReason(e.target.value as ModerationReason)}>
          {(Object.keys(MODERATION_REASONS) as ModerationReason[]).map((k) => (
            <option key={k} value={k}>{MODERATION_REASONS[k].label}</option>
          ))}
        </select>
        <textarea className="input min-h-24" name="explanation" required minLength={30} placeholder="Public explanation: what was found, where, and why it meets the policy." />
        <input className="input" name="evidence_url" placeholder={reason === "fabrication" || reason === "plagiarism" ? "Evidence link (required)" : "Evidence link (optional)"} />
        <p className="hint">
          Effect: <strong>{effect === "retract" ? "retract (stays readable, marked RETRACTED)" : "hide (replaced by a notice)"}</strong>.
          This goes into the public log under your name and can be appealed.
        </p>
        <Submit>Take action</Submit>
        <ErrorNote state={state} />
      </form>
      <form action={dismiss} className="space-y-2">
        <input type="hidden" name="report_id" value={reportId} />
        <textarea className="input min-h-24" name="note" required minLength={10} placeholder="Why this report doesn't meet the policy (e.g. it's a scientific disagreement)." />
        <Submit className="btn-ghost">Dismiss report</Submit>
        <ErrorNote state={dState} />
      </form>
    </div>
  );
}

export function AppealForm({ actionSeq }: { actionSeq: number }) {
  const [state, action] = useActionState(appealAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="action_seq" value={actionSeq} />
      <textarea className="input min-h-28" name="statement" required minLength={50} placeholder="Explain why this decision is wrong, with evidence. A different moderator will decide, in public." />
      <Submit>File appeal</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

export function ResolveAppealForm({ actionSeq, appealId }: { actionSeq: number; appealId: string }) {
  const [state, action] = useActionState(resolveAppealAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="action_seq" value={actionSeq} />
      <input type="hidden" name="appeal_id" value={appealId} />
      <textarea className="input min-h-24" name="resolution" required minLength={30} placeholder="Public reasoning for your decision." />
      <div className="flex gap-2">
        <button name="outcome" value="overturned" className="btn">Overturn &amp; restore</button>
        <button name="outcome" value="upheld" className="btn-ghost">Uphold decision</button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}
