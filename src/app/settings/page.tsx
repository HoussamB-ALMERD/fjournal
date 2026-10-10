import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { orcidConfig } from "@/lib/orcid";
import { disconnectOrcid } from "@/app/actions";
import { ProfileForm, ReportSettingsForm } from "@/components/forms";
import { highlightableWorks, reportSettingsOf } from "@/lib/report";
import { OrcidButton } from "@/components/OrcidButton";
import { OrcidBadge } from "@/components/ui";
import Link from "next/link";
import { ROLES, invitationsFor } from "@/lib/collections";
import { InvitationResponseForm } from "@/components/CollectionForms";

export const metadata = { title: "Profile settings" };

const NOTES: Record<string, [ok: boolean, text: string]> = {
  linked: [true, "ORCID connected. Your iD is now verified."],
  disconnected: [true, "ORCID disconnected."],
  taken: [false, "That ORCID iD is already verified on another Fjournal account."],
  cancelled: [false, "ORCID connection was cancelled."],
  failed: [false, "ORCID couldn't confirm the connection. Please try again."],
  unavailable: [false, "ORCID isn't configured on this Fjournal instance yet."],
  "needs-password": [false, "Your account signs in only through ORCID, so it can't be disconnected (you'd be locked out)."],
};

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const me = await currentUser();
  if (!me) redirect("/login?next=/settings");
  const { orcid } = await searchParams;
  const note = typeof orcid === "string" ? NOTES[orcid] : undefined;
  const invitations = invitationsFor(me.id);
  const report = reportSettingsOf(me.id);
  return (
    <div className="mx-auto max-w-lg space-y-8">
      <h1 className="font-serif text-3xl font-bold">Your profile</h1>
      {note && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${note[0] ? "border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-red-500/40 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          {note[1]}
        </p>
      )}

      {invitations.length > 0 && (
        <section className="card space-y-4 border-accent/50 p-5" id="invitations">
          <h2 className="font-semibold">Editorial board invitations</h2>
          {invitations.map((i) => (
            <div key={i.collection_id} className="space-y-2 text-sm">
              <p>
                {i.invited_by_handle ? `@${i.invited_by_handle}` : "A managing editor"} invited you to join{" "}
                <Link href={`/j/${i.slug}`} className="font-semibold text-accent underline">{i.name}</Link> as {ROLES[i.role].label.toLowerCase()}.
                Board membership and decisions are public.
              </p>
              <InvitationResponseForm collectionId={i.collection_id} />
            </div>
          ))}
        </section>
      )}

      <section className="card space-y-3 p-5" id="orcid">
        <h2 className="font-semibold">ORCID</h2>
        {me.orcid_verified_at ? (
          <>
            <OrcidBadge orcid={me.orcid!} />
            <p className="text-sm text-muted">
              Verified. Your iD goes into the DataCite record of every review DOI you register. You can also claim authorship
              of imported papers that are listed on your ORCID record.
            </p>
            <form action={disconnectOrcid}>
              <button className="text-xs text-muted underline hover:text-ink">Disconnect ORCID</button>
            </form>
          </>
        ) : orcidConfig() ? (
          <>
            <p className="text-sm text-muted">
              Connect your ORCID iD to prove who you are without any credential gate. It links your review DOIs to your ORCID
              record and lets you claim papers you wrote. ORCID is free for everyone.
            </p>
            <OrcidButton href="/auth/orcid?mode=link">Connect ORCID</OrcidButton>
          </>
        ) : (
          <p className="text-sm text-muted">ORCID sign-in isn&apos;t configured on this Fjournal instance yet.</p>
        )}
      </section>

      <ProfileForm user={me} />

      <section className="card space-y-3 p-5" id="report">
        <div className="flex items-baseline gap-3">
          <h2 className="font-semibold">Your scrutiny report</h2>
          <Link href={`/u/${me.handle}/report`} className="ml-auto text-sm text-accent underline">Open it</Link>
        </div>
        <p className="text-sm text-muted">
          A one-page summary of your public record for hiring and funding committees. You choose only two things: a statement
          in your own words, and which works to be judged on. Everything else is the record as it stands.
        </p>
        <ReportSettingsForm statement={report.statement} highlights={report.highlights} works={highlightableWorks(me.id)} />
      </section>
    </div>
  );
}
