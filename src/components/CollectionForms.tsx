"use client";

import { useActionState, useState } from "react";
import {
  createCollectionAction,
  decideAction,
  deselectAction,
  inviteMemberAction,
  leaveBoardAction,
  manageMemberAction,
  nominateAction,
  respondInvitationAction,
  submitToCollectionAction,
  updateCollectionAction,
  withdrawFromCollectionAction,
} from "@/app/actions";
import type { Collection, Role } from "@/lib/collections";
import { onAccent, slugify } from "@/lib/color";
import { ErrorNote, Submit } from "./forms";

const ROLE_OPTIONS: [Role, string][] = [
  ["editor", "Editor: decides on and nominates works"],
  ["managing", "Managing editor: also manages the board and the policy"],
];

// ───────────────────────────── Founding & policy ─────────────────────────────

export function CollectionForm({ collection }: { collection?: Collection }) {
  const [state, action] = useActionState(collection ? updateCollectionAction : createCollectionAction, undefined);
  const [name, setName] = useState(collection?.name ?? "");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [accent, setAccent] = useState(collection?.accent ?? "#1d4ed8");
  const [tagline, setTagline] = useState(collection?.tagline ?? "");
  const [moving, setMoving] = useState(!!collection?.continues);
  const shownSlug = slugTouched ? slug : slugify(name);

  return (
    <form action={action} className="space-y-8">
      {collection && <input type="hidden" name="collection_id" value={collection.id} />}

      <div className="overflow-hidden rounded-lg border border-line" aria-hidden>
        <div className="px-5 py-6" style={{ background: accent, color: onAccent(accent) }}>
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Collection on Fjournal</p>
          <p className="font-serif text-2xl font-bold">{name || "Your collection's name"}</p>
          {tagline && <p className="mt-1 text-sm opacity-90">{tagline}</p>}
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold">Name and identity</h2>
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input className="input" id="name" name="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Open Ecology Letters" />
          </div>
          <div>
            <label className="label" htmlFor="accent">Colour</label>
            <input className="input h-[38px] p-1" id="accent" name="accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </div>
        </div>
        {!collection && (
          <div>
            <label className="label" htmlFor="slug">Address</label>
            <div className="flex items-center gap-1 text-sm">
              <span className="font-mono text-muted">/j/</span>
              <input
                className="input font-mono"
                id="slug"
                name="slug"
                required
                value={shownSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
              />
            </div>
            <p className="hint">Permanent. Pick something short your community will recognise.</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="tagline">Tagline <span className="font-normal text-muted">(optional)</span></label>
          <input className="input" id="tagline" name="tagline" maxLength={200} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Field ecology, long-term data, and the replications that test it" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold">What you select, and how</h2>
        <div>
          <label className="label" htmlFor="scope">Scope</label>
          <textarea className="input min-h-24" id="scope" name="scope" required minLength={30} defaultValue={collection?.scope} placeholder="Which fields, questions and kinds of work the collection covers. Replications and negative results in scope?" />
        </div>
        <div>
          <label className="label" htmlFor="policy">Selection criteria</label>
          <textarea
            className="input min-h-40"
            id="policy"
            name="policy"
            required
            minLength={100}
            defaultValue={collection?.policy}
            placeholder={"What a work must show to be selected, written so anyone can check each decision against it. For example:\n- Claims follow from the data and analyses shown\n- Data and code are available, or their absence is justified\n- Public reviews raised no unresolved methodological problems"}
          />
          <p className="hint">
            Every decision is pinned to the criteria in force when it was made. If you change them, the change is logged
            with a date, and earlier decisions keep pointing to the version they followed.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="min_reviews">Public reviews required before selecting</label>
            <input className="input" id="min_reviews" name="min_reviews" type="number" min={1} max={10} required defaultValue={collection?.min_reviews ?? 2} />
            <p className="hint">Decisions rest on open review that anyone can read, not on private reports.</p>
          </div>
          <label className="flex items-start gap-2 self-center text-sm">
            <input type="checkbox" name="accepts_submissions" value="1" defaultChecked={collection ? !!collection.accepts_submissions : true} className="mt-1" />
            <span>Authors can submit their work. <span className="text-muted">Untick if your editors only nominate (an overlay journal).</span></span>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-lg font-semibold">Is your board leaving a journal?</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={moving} onChange={(e) => setMoving(e.target.checked)} className="mt-1" />
          <span>Yes: this collection continues the community of a journal whose editorial board left its publisher.</span>
        </label>
        {moving && (
          <div className="card grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="lineage_journal">Journal you are continuing</label>
              <input className="input" id="lineage_journal" name="lineage_journal" required defaultValue={collection?.continues?.journal} />
            </div>
            <div>
              <label className="label" htmlFor="lineage_publisher">Its publisher</label>
              <input className="input" id="lineage_publisher" name="lineage_publisher" defaultValue={collection?.continues?.publisher} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="lineage_statement">Link to the board&apos;s public statement</label>
              <input className="input" id="lineage_statement" name="lineage_statement" type="url" required defaultValue={collection?.continues?.statement_url} placeholder="https://… resignation letter, announcement or news report" />
              <p className="hint">
                Shown next to the claim, with how many board members have verified their identity through ORCID, so readers
                can judge it for themselves. Claiming a lineage you don&apos;t have is impersonation.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="lineage_year">Year the board moved</label>
              <input className="input" id="lineage_year" name="lineage_year" inputMode="numeric" defaultValue={collection?.continues?.year ?? ""} placeholder="2026" />
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <ErrorNote state={state} />
        <div className="flex flex-wrap items-center gap-4">
          <Submit>{collection ? "Save policy" : "Found the collection"}</Submit>
          <p className="text-xs text-muted">
            {collection
              ? "The new settings are snapshotted into the public log."
              : "Free, forever. You become its first managing editor; invite the rest of your board next."}
          </p>
        </div>
      </div>
    </form>
  );
}

// ───────────────────────────── The board ─────────────────────────────

export function InviteForm({ collectionId }: { collectionId: string }) {
  const [state, action] = useActionState(inviteMemberAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="collection_id" value={collectionId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input font-mono" name="handle" required placeholder="@handle" aria-label="Member handle" />
        <select className="input sm:w-56" name="role" defaultValue="editor" aria-label="Role">
          {ROLE_OPTIONS.map(([r, label]) => (
            <option key={r} value={r}>{label}</option>
          ))}
        </select>
        <Submit className="btn shrink-0">Invite</Submit>
      </div>
      <p className="hint">They need a Fjournal account. Board members who verify their ORCID iD are marked as verified.</p>
      <ErrorNote state={state} />
    </form>
  );
}

export function InvitationResponseForm({ collectionId }: { collectionId: string }) {
  const [state, action] = useActionState(respondInvitationAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="collection_id" value={collectionId} />
      <div className="flex gap-2">
        <button name="answer" value="accept" className="btn">Join the board</button>
        <button name="answer" value="decline" className="btn-ghost">Decline</button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function MemberForm({ collectionId, userId, role, invited }: { collectionId: string; userId: string; role: Role; invited: boolean }) {
  const [state, action] = useActionState(manageMemberAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="collection_id" value={collectionId} />
      <input type="hidden" name="user_id" value={userId} />
      {!invited && (
        <div className="flex gap-2">
          <select className="input" name="role" defaultValue={role} aria-label="Role">
            {ROLE_OPTIONS.map(([r, label]) => (
              <option key={r} value={r}>{label}</option>
            ))}
          </select>
          <button name="op" value="role" className="btn-ghost shrink-0">Change role</button>
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted hover:text-ink">{invited ? "Withdraw invitation" : "Remove from the board"}</summary>
        <div className="mt-2 space-y-2">
          <input className="input" name="reason" placeholder="Public reason (goes into the log)" />
          <button name="op" value="remove" className="btn-ghost">{invited ? "Withdraw invitation" : "Remove"}</button>
        </div>
      </details>
      <ErrorNote state={state} />
    </form>
  );
}

export function LeaveBoardForm({ collectionId }: { collectionId: string }) {
  const [state, action] = useActionState(leaveBoardAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="collection_id" value={collectionId} />
      <Submit className="btn-ghost">Leave the board</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

// ───────────────────────────── Works ─────────────────────────────

export function SubmitToCollectionForm({ contributionId, options }: { contributionId: string; options: { id: string; name: string }[] }) {
  const [state, action] = useActionState(submitToCollectionAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-sm">
      <summary className="btn-ghost w-full cursor-pointer list-none">Submit to a collection</summary>
      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="contribution_id" value={contributionId} />
        <select className="input" name="collection_id" required defaultValue="" aria-label="Collection">
          <option value="" disabled>Choose a collection…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <textarea className="input min-h-16" name="note" placeholder="Optional note to the board: why it fits." maxLength={2000} />
        <p className="hint">
          Your work is already published; a collection only adds a board&apos;s public judgement. Decisions, including
          &ldquo;not selected&rdquo;, are public and reasoned. You can withdraw at any time.
        </p>
        <Submit className="btn w-full">Submit</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}

export function NominateForm({ collectionId }: { collectionId: string }) {
  const [state, action] = useActionState(nominateAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="collection_id" value={collectionId} />
      <input className="input font-mono" name="identifier" required placeholder="fj:2026.k3x9qa · arXiv ID · DOI · link" aria-label="Work to nominate" />
      <textarea className="input min-h-16" name="note" placeholder="Why it fits the collection (optional, public)" maxLength={2000} />
      <p className="hint">Papers from arXiv, bioRxiv or any DOI are opened for review first, so they can gather public reviews.</p>
      <Submit className="btn">Nominate</Submit>
      <ErrorNote state={state} />
    </form>
  );
}

export function WithdrawForm({ collectionId, contributionId, label }: { collectionId: string; contributionId: string; label: string }) {
  const [state, action] = useActionState(withdrawFromCollectionAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">{label}</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="collection_id" value={collectionId} />
        <input type="hidden" name="contribution_id" value={contributionId} />
        <input className="input" name="note" placeholder="Optional public note" maxLength={2000} />
        <Submit className="btn-ghost">{label}</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}

export function DecisionForm({
  collectionId,
  contributionId,
  nominated,
  reviewCount,
  minReviews,
}: {
  collectionId: string;
  contributionId: string;
  nominated: boolean;
  reviewCount: number;
  minReviews: number;
}) {
  const [state, action] = useActionState(decideAction, undefined);
  const [coi, setCoi] = useState("");
  if (state?.ok) return <ErrorNote state={state} />;
  const enough = reviewCount >= minReviews;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="collection_id" value={collectionId} />
      <input type="hidden" name="contribution_id" value={contributionId} />
      <textarea
        className="input min-h-24"
        name="note"
        required
        minLength={30}
        placeholder="Your reasoning, against the collection's criteria. Public and signed. Cite the reviews that informed it."
      />
      <fieldset className="space-y-1 text-sm">
        <legend className="label">Your competing interests</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="coi_mode" value="none" required checked={coi === "none"} onChange={() => setCoi("none")} className="mt-1" />
          <span>None with the authors or this work.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="coi_mode" value="declare" checked={coi === "declare"} onChange={() => setCoi("declare")} className="mt-1" />
          <span>I have something to declare.</span>
        </label>
        {coi === "declare" && <input className="input" name="coi_text" required placeholder="e.g. Same department as the second author." />}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button name="decision" value="select" className="btn" disabled={!enough}>Select</button>
        {!nominated && <button name="decision" value="decline" className="btn-ghost">Not selected</button>}
        <span className="text-xs text-muted">
          {enough
            ? `${reviewCount} public review${reviewCount === 1 ? "" : "s"} (policy: at least ${minReviews}).`
            : `Needs ${minReviews - reviewCount} more public review${minReviews - reviewCount === 1 ? "" : "s"} before it can be selected.`}
        </span>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function DeselectForm({ collectionId, contributionId }: { collectionId: string; contributionId: string }) {
  const [state, action] = useActionState(deselectAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">Withdraw the selection</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="collection_id" value={collectionId} />
        <input type="hidden" name="contribution_id" value={contributionId} />
        <textarea className="input min-h-16" name="note" required minLength={30} placeholder="Public reasoning, e.g. a failed replication or a retraction." />
        <Submit className="btn-ghost">Withdraw selection</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}
