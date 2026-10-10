"use client";

import { useActionState, useState } from "react";
import {
  publishAssessmentAction,
  requestCorrectionAction,
  resolveCorrectionAction,
  reviewReplyAction,
  submitReplyAction,
  withdrawAssessmentAction,
} from "@/app/actions";
import { ErrorNote, Submit } from "./forms";

const CORRECTION_TOPICS: [string, string][] = [
  ["statistics", "Statistical reporting (e.g. a test misread, or a one-tailed test that was stated)"],
  ["data", "Data availability (e.g. the statement was misclassified)"],
  ["license", "Open licence"],
  ["retractions", "Retraction figures"],
  ["other", "Something else"],
];

export function PublishAssessmentForm({ id, own }: { id: string; own: boolean }) {
  const [state, action] = useActionState(publishAssessmentAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="assessment_id" value={id} />
      {own ? (
        <p className="text-xs text-muted">You ran this sweep, so another moderator has to check and publish it.</p>
      ) : (
        <Submit>I checked it: publish</Submit>
      )}
      <ErrorNote state={state} />
    </form>
  );
}

export function WithdrawAssessmentForm({ id }: { id: string }) {
  const [state, action] = useActionState(withdrawAssessmentAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">Withdraw</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="assessment_id" value={id} />
        <input className="input" name="reason" required minLength={20} placeholder="Public reason, e.g. a sampling error was found" />
        <Submit className="btn-ghost">Withdraw assessment</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}

export function ReplyForm({ issn }: { issn: string }) {
  const [state, action] = useActionState(submitReplyAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-accent">Do you speak for this journal? Reply</summary>
      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="issn" value={issn} />
        <input className="input" name="role" required placeholder="Your role, e.g. Editor-in-chief, Research integrity officer" />
        <textarea className="input min-h-28" name="body" required minLength={50} maxLength={5000} placeholder="Your reply. It is published exactly as written, next to the figures." />
        <p className="hint">A moderator confirms you speak for the journal (for example by writing to its official address) before it appears.</p>
        <Submit>Send reply</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}

export function ReviewReplyForm({ id, issn }: { id: string; issn: string }) {
  const [state, action] = useActionState(reviewReplyAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="reply_id" value={id} />
      <input type="hidden" name="issn" value={issn} />
      <input className="input" name="note" required minLength={10} placeholder="How identity was confirmed, or why it's rejected (public)" />
      <div className="flex gap-2">
        <button name="decision" value="publish" className="btn">Publish verbatim</button>
        <button name="decision" value="reject" className="btn-ghost">Reject</button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}

export function CorrectionForm({ assessmentId, dois }: { assessmentId: string; dois: string[] }) {
  const [state, action] = useActionState(requestCorrectionAction, undefined);
  const [topic, setTopic] = useState("");
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-accent">Something wrong? Request a correction</summary>
      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="assessment_id" value={assessmentId} />
        <select className="input" name="indicator" required value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="About">
          <option value="" disabled>What is it about?</option>
          {CORRECTION_TOPICS.map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {topic && topic !== "retractions" && topic !== "other" && (
          <select className="input font-mono" name="doi" defaultValue="" aria-label="Article">
            <option value="">The journal-level figure</option>
            {dois.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <textarea className="input min-h-24" name="claim" required minLength={30} placeholder="What is wrong, and why. Be specific: quote the article where you can." />
        <input className="input" name="evidence_url" type="url" placeholder="Evidence link (optional)" />
        <p className="hint">Requests and their resolutions are public. If accepted, an article is removed from that indicator and the figure updates.</p>
        <Submit>File correction request</Submit>
        <ErrorNote state={state} />
      </form>
    </details>
  );
}

export function ResolveCorrectionForm({ id, issn }: { id: string; issn: string }) {
  const [state, action] = useActionState(resolveCorrectionAction, undefined);
  if (state?.ok) return <ErrorNote state={state} />;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="correction_id" value={id} />
      <input type="hidden" name="issn" value={issn} />
      <textarea className="input min-h-16" name="resolution" required minLength={20} placeholder="Public resolution: what was checked and what changes" />
      <div className="flex gap-2">
        <button name="decision" value="accept" className="btn">Accept</button>
        <button name="decision" value="reject" className="btn-ghost">Reject</button>
      </div>
      <ErrorNote state={state} />
    </form>
  );
}
