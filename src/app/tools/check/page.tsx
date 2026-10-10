import { StatChecker } from "@/components/StatChecker";

export const metadata = { title: "Statistics checker" };

export default function CheckToolPage() {
  return (
    <div className="space-y-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="font-serif text-3xl font-bold">Statistics consistency checker</h1>
        <p className="text-muted">
          Paste the results section of <em>any</em> paper. We recompute every p-value from its test statistic and degrees
          of freedom (the statcheck method), and test whether reported means are possible for the sample size (GRIM).
          It runs entirely in your browser; nothing is uploaded. The same checks run automatically on every Fjournal version.
        </p>
        <p className="text-xs text-muted">
          A mismatch is a question, not a verdict: typos, one-tailed tests, corrections and continuous measures all cause legitimate ones.
        </p>
      </header>
      <StatChecker />
    </div>
  );
}
