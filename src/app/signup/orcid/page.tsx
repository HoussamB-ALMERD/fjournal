import Link from "next/link";
import { cookies } from "next/headers";
import { unsign } from "@/lib/config";
import { OrcidSignupForm } from "@/components/forms";
import { OrcidBadge } from "@/components/ui";

export const metadata = { title: "Join with ORCID" };

export default async function OrcidSignupPage() {
  const pending = await unsign<{ orcid: string; name: string }>((await cookies()).get("fj_orcid_pending")?.value);
  if (!pending)
    return (
      <div className="mx-auto max-w-sm space-y-4 py-10">
        <h1 className="font-serif text-3xl font-bold">Sign-in expired</h1>
        <p className="text-sm text-muted">Your ORCID sign-in has expired or wasn&apos;t completed.</p>
        <a href="/auth/orcid" className="btn">Sign in with ORCID again</a>
      </div>
    );
  return (
    <div className="mx-auto max-w-sm space-y-6 py-10">
      <div className="space-y-2">
        <h1 className="font-serif text-3xl font-bold">Welcome to Fjournal</h1>
        <p className="text-sm text-muted">ORCID confirmed your identity:</p>
        <OrcidBadge orcid={pending.orcid} />
        <p className="text-sm text-muted">
          Choose a handle to finish. Your iD will be attached to every review DOI you register, so your reviews count on your
          record. Already have a Fjournal account? <Link href="/login?next=/settings" className="text-accent underline">Sign in with your password</Link> and
          connect ORCID in settings instead.
        </p>
      </div>
      <OrcidSignupForm name={pending.name} />
    </div>
  );
}
