import Link from "next/link";
import { LoginForm } from "@/components/forms";
import { ORCID_MESSAGES, OrcidButton } from "@/components/OrcidButton";
import { orcidConfig } from "@/lib/orcid";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  const message = typeof error === "string" ? ORCID_MESSAGES[error] : undefined;
  return (
    <div className="mx-auto max-w-sm space-y-6 py-10">
      <h1 className="font-serif text-3xl font-bold">Sign in</h1>
      {message && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {message}
        </p>
      )}
      {orcidConfig() && (
        <>
          <OrcidButton href={`/auth/orcid?mode=login&next=${encodeURIComponent(nextPath ?? "/")}`}>Sign in with ORCID</OrcidButton>
          <p className="text-center text-xs text-muted">or with your handle and password</p>
        </>
      )}
      <LoginForm next={nextPath} />
      <p className="text-sm text-muted">
        New here? <Link href="/signup" className="text-accent underline">Create an account</Link>
      </p>
    </div>
  );
}
