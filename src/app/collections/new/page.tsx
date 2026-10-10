import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { CollectionForm } from "@/components/CollectionForms";

export const metadata = { title: "Found a collection" };

export default async function NewCollectionPage() {
  const me = await currentUser();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <h1 className="font-serif text-3xl font-bold">Found a collection</h1>
        <p className="text-muted">
          A collection is your board&apos;s public judgement on top of open publication: you choose the scope and the
          criteria, then select work in the open. No fees, no contract, no publisher. If your board leaves, the whole
          collection, including its log, can be exported through the open API.
        </p>
      </header>
      {me ? (
        <CollectionForm />
      ) : (
        <p className="card p-6 text-sm">
          <Link href="/login?next=/collections/new" className="text-accent underline">Sign in</Link> to found a collection.
        </p>
      )}
    </div>
  );
}
