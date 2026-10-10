import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="font-serif text-3xl font-bold">Not found</h1>
      <p className="mt-2 text-muted">That page, contribution or person doesn&apos;t exist.</p>
      <Link href="/" className="btn mt-6">Back to Fjournal</Link>
    </div>
  );
}
