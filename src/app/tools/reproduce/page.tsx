import Link from "next/link";
import { ALLOWED_IMAGES_HINT, LIMITS } from "@/lib/repro/manifest";
import { ManifestValidator } from "@/components/ManifestValidator";

export const metadata = { title: "Reproducibility bot" };

const EXAMPLE = `{
  "version": 1,
  "image": "python:3.12-slim",
  "setup": "pip install --no-cache-dir -r requirements.txt",
  "run": "python reproduce.py",
  "timeout_minutes": 20,
  "outputs": [
    {
      "claim": "Held-out Spearman correlation (Table 2)",
      "file": "results/metrics.json",
      "json": "heldout.spearman",
      "reported": "0.61"
    },
    {
      "claim": "Accuracy of the baseline on the test split",
      "file": "results/table2.csv",
      "csv": { "column": "accuracy", "where": { "model": "baseline" } },
      "reported": 0.834,
      "tolerance": 0.002
    },
    {
      "claim": "Number of sites with complete records",
      "file": "logs/run.txt",
      "after": "complete sites:",
      "reported": 412
    }
  ]
}`;

export default function ReproducePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-4">
        <h1 className="font-serif text-4xl font-bold">The reproducibility bot</h1>
        <p className="text-lg leading-8 text-muted">
          A journal asks you to trust that the numbers in a paper came from the code. Fjournal checks. Pin your code to a
          commit, add one small file, and the bot re-runs your analysis from scratch on every version. If every declared
          result comes out the same, the work earns the <strong>Computationally reproduced</strong> badge, for everyone to
          see.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">How to take part</h2>
        <ol className="list-decimal space-y-2 pl-5 leading-7">
          <li>Put your code on GitHub and attach it to your contribution as a <em>code</em> artifact, with the commit SHA as its pin.</li>
          <li>
            Add <code>fjournal.json</code> at the root of the repository, at that commit. It names a container image, the
            commands to install and run, and the results the run must produce, each tied to a claim in the paper.
          </li>
          <li>Publish. The bot queues a run automatically, and anyone can ask for a re-run.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">What the bot does</h2>
        <ul className="list-disc space-y-2 pl-5 leading-7">
          <li>Downloads the exact pinned commit and records the archive&apos;s SHA-256 and the image digest.</li>
          <li>
            Runs <code>setup</code> with network access, to install dependencies (up to {LIMITS.setupMinutes} minutes). Then it runs{" "}
            <code>run</code> with <strong>no network at all</strong>, as an unprivileged user, with memory, CPU and time
            limits (up to {LIMITS.runMinutes} minutes). Results can&apos;t be downloaded from anywhere; they have to be computed.
          </li>
          <li>
            Reads each declared output and compares it to the reported value. Without an explicit tolerance, a value matches
            if it rounds to what you reported: <code>&quot;0.61&quot;</code> allows ±0.005, and <code>&quot;0.610&quot;</code>{" "}
            allows ±0.0005. Write the value as a string to keep trailing zeros.
          </li>
          <li>Notes whether each reported value literally appears in your paper&apos;s text, so readers can check they match.</li>
          <li>Publishes everything: per-claim results, the output log, timings, and a hash of the outcome.</li>
        </ul>
        <p className="text-sm text-muted">
          A mismatch is information, not an accusation. Hardware, library versions and random seeds all move numbers. Pin
          image digests and dependency versions, and set seeds, and the bot will agree with you.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Reading outputs</h2>
        <div className="card divide-y divide-line text-sm">
          {[
            ["json", '"json": "metrics.test[0].auc"', "A number at a path in a JSON file."],
            ["csv", '"csv": { "column": "auc", "row": 0 }  or  "where": { "model": "ours" }', "A cell in a CSV table, picked by row number or by matching other columns."],
            ["after", '"after": "Final loss:"', "The first number after a piece of text, e.g. in a log."],
            ["sha256", '"sha256": "9f86d0…"', "The whole file must be byte-identical (figures, exact tables)."],
          ].map(([k, ex, what]) => (
            <div key={k} className="grid gap-1 p-3 sm:grid-cols-[80px_1fr]">
              <strong className="font-mono">{k}</strong>
              <div>
                <code className="text-xs">{ex}</code>
                <p className="text-muted">{what}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">Allowed images: {ALLOWED_IMAGES_HINT}. Pin one by digest (<code>python:3.12-slim@sha256:…</code>) for an exact environment.</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Check your manifest</h2>
        <p className="text-sm text-muted">Validated in your browser with the same rules the bot uses.</p>
        <ManifestValidator example={EXAMPLE} />
      </section>

      <p className="text-sm text-muted">
        Questions about a result? Discuss it on the contribution page, or <Link href="/about#integrity" className="text-accent underline">read how the other checks work</Link>.
      </p>
    </div>
  );
}
