import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { isModerator } from "@/lib/moderation";
import { canViewIndex, indexPublic, listIndex } from "@/lib/index/index";
import { PropCell, PreviewBanner } from "@/components/IndexBits";

export const metadata = { title: "Journal Integrity Index" };

export default async function IndexPage({ searchParams }: PageProps<"/journals">) {
  const me = await currentUser();
  const { field } = await searchParams;
  const intro = (
    <header className="max-w-3xl space-y-3">
      <h1 className="font-serif text-4xl font-bold">Journal Integrity Index</h1>
      <p className="text-lg leading-8 text-muted">
        Journals have ranked scientists by where they publish. This turns the scrutiny around: open, sampled, checkable
        measurements of how journals&apos; articles hold up. How often reported statistics contradict themselves, whether
        the data is available, whether articles are openly licensed, and how often and how fast articles are retracted.
      </p>
      <p className="text-sm text-muted">
        Separate indicators with uncertainty and field baselines, never a single score or a league table. Every figure traces to
        the articles behind it, journals have a right of reply, and anyone can request a correction.{" "}
        <Link href="/journals/method" className="text-accent underline">Read the method</Link>.
      </p>
    </header>
  );
  if (!(await canViewIndex(me)))
    return (
      <div className="space-y-6">
        {intro}
        <div className="card max-w-3xl space-y-2 p-5 text-sm">
          <p className="font-semibold">Not published yet.</p>
          <p className="text-muted">
            The method is public now so it can be scrutinised before any results are. Results will be published once
            research-integrity researchers have reviewed the method. Comments on the method are welcome in the discussion.
          </p>
        </div>
      </div>
    );

  const rows = await listIndex(await isModerator(me));
  const fields = [...new Set(rows.map((r) => r.journal.field))].sort();
  const shown = typeof field === "string" && field ? rows.filter((r) => r.journal.field === field) : rows;

  return (
    <div className="space-y-6">
      <PreviewBanner notPublic={!indexPublic()} />
      {intro}
      {fields.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link href="/journals" className={`rounded-md border px-2.5 py-1 ${!field ? "border-accent text-accent" : "border-line text-muted"}`}>All fields</Link>
          {fields.map((f) => (
            <Link key={f} href={`/journals?field=${encodeURIComponent(f)}`} className={`rounded-md border px-2.5 py-1 ${field === f ? "border-accent text-accent" : "border-line text-muted"}`}>
              {f}
            </Link>
          ))}
        </nav>
      )}
      {shown.length === 0 ? (
        <p className="card p-6 text-sm text-muted">No journals assessed yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Journal (alphabetical)</th>
                <th className="px-3 py-2">Window · sample</th>
                <th className="px-3 py-2" title="Articles whose reported p contradicts its statistic so that significance flips">Statistics: flips</th>
                <th className="px-3 py-2">Data shared</th>
                <th className="px-3 py-2">CC licence</th>
                <th className="px-3 py-2">Retracted per 10,000</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {shown.map(({ journal: j, assessment: a, indicators: i }) => (
                <tr key={j.issn}>
                  <td className="px-3 py-2">
                    <Link href={`/journals/${j.issn}`} className="font-medium hover:text-accent">{j.title}</Link>
                    <span className="block text-xs text-muted">{j.publisher} · {j.field}{a.status === "draft" && " · DRAFT"}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{a.window_from.slice(0, 4)}–{a.window_until.slice(0, 4)} · n={i.sample}</td>
                  <td className="px-3 py-2"><PropCell p={i.statistics.gross} /></td>
                  <td className="px-3 py-2"><PropCell p={i.data.shared} /></td>
                  <td className="px-3 py-2"><PropCell p={i.license.cc} /></td>
                  <td className="px-3 py-2"><PropCell p={i.retractions.rate} scale={10_000} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        &ldquo;–&rdquo; means too few articles to say anything. Hover a figure for its interval and sample. Open data:{" "}
        <Link href="/api/journals" prefetch={false} className="underline">/api/journals</Link>.
      </p>
    </div>
  );
}
