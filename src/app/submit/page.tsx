import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { ContributionForm } from "@/components/forms";

export const metadata = { title: "Publish" };

export default async function SubmitPage({ searchParams }: PageProps<"/submit">) {
  const sp = await searchParams;
  const replicate = typeof sp.replicate === "string" ? sp.replicate : undefined;
  const me = await currentUser();

  if (!me) {
    const next = replicate ? `/submit?replicate=${replicate}` : "/submit";
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <h1 className="font-serif text-3xl font-bold">Publish on Fjournal</h1>
        <p className="text-muted">
          Free, immediate, permanent, and you keep your copyright. You need an account so your work and reviews are
          attributed to you — no degree or affiliation required.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/signup" className="btn">Create account</Link>
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-ghost">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold">Publish your work</h1>
        <p className="mt-2 text-muted">
          It goes live the moment you press publish. There is no editor deciding whether it &ldquo;fits&rdquo;. The community
          evaluates it in the open, and you can post improved versions any time.
        </p>
      </div>
      <ContributionForm mode="new" replicationOf={replicate} defaultAuthor={me.display_name} />
    </div>
  );
}
