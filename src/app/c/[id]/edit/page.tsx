import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getContribution, getVersion } from "@/lib/queries";
import { ContributionForm } from "@/components/forms";

export const metadata = { title: "New version" };

export default async function EditPage({ params }: PageProps<"/c/[id]/edit">) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/login?next=/c/${id}/edit`);
  const c = await getContribution(id);
  if (!c) notFound();
  if (c.owner_id !== me.id) redirect(`/c/${id}`);
  const v = await getVersion(id, c.latest_version)!;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={`/c/${id}`} className="text-sm text-muted hover:text-ink">← Back to v{c.latest_version}</Link>
        <h1 className="mt-2 font-serif text-3xl font-bold">Post version {c.latest_version + 1}</h1>
        <p className="mt-2 text-muted">
          Improve the work in response to reviews, fix errors, add data. Version {c.latest_version} and its reviews stay
          public and unchanged — the history is part of the scientific record.
        </p>
      </div>
      <ContributionForm mode="version" contributionId={id} initial={v} defaultAuthor={me.display_name} />
    </div>
  );
}
