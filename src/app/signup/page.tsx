import Link from "next/link";
import { SignupForm } from "@/components/forms";
import { OrcidButton } from "@/components/OrcidButton";
import { orcidConfig } from "@/lib/orcid";

export const metadata = { title: "Join" };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm space-y-6 py-10">
      <div>
        <h1 className="font-serif text-3xl font-bold">Join Fjournal</h1>
        <p className="mt-2 text-sm text-muted">
          No degree, title or institution required. You earn standing by the quality of what you contribute.
        </p>
      </div>
      {orcidConfig() && (
        <>
          <OrcidButton href="/auth/orcid?mode=login">Join with ORCID</OrcidButton>
          <p className="text-center text-xs text-muted">
            Optional, free, and it puts your reviews on your ORCID record. Or pick a handle and password:
          </p>
        </>
      )}
      <SignupForm />
      <p className="text-sm text-muted">
        Already have an account? <Link href="/login" className="text-accent underline">Sign in</Link>
      </p>
    </div>
  );
}
