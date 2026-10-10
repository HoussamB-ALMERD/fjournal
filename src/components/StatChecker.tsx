"use client";

import { useMemo, useState } from "react";
import { statisticalChecks, type Finding } from "@/lib/integrity/stats";

const EXAMPLE = `Participants in the intervention group scored higher, t(48) = 2.31, p = .025.
The interaction was significant, F(2, 96) = 1.20, p = .03.
Accuracy correlated with age, r(58) = .29, p = .02, χ2(1) = 4.10, p < .05.
Group A (M = 3.47, n = 17) and group B (M = 4.12, n = 19) rated the item on a 7-point scale.`;

const TONE: Record<Finding["status"], string> = {
  pass: "border-emerald-600/40",
  info: "border-line",
  warn: "border-amber-500/60",
  fail: "border-red-600/60",
};
const LABEL: Record<Finding["status"], string> = { pass: "Consistent", info: "Info", warn: "Look at this", fail: "Inconsistent" };

export function StatChecker() {
  const [text, setText] = useState("");
  const result = useMemo(() => statisticalChecks(text), [text]);
  const findings = [...result.tests, ...result.grim];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-2">
        <textarea
          className="input min-h-96 font-mono text-[13px] leading-6"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a results section from any paper, on Fjournal or anywhere else..."
        />
        <button type="button" className="text-xs text-accent underline" onClick={() => setText(EXAMPLE)}>
          Try an example
        </button>
      </div>
      <div className="space-y-2">
        {text && findings.length === 0 && (
          <p className="text-sm text-muted">No checkable statistics found. Expected formats: t(28) = 2.20, p = .036 · F(2, 57) = 3.16, p &lt; .05 · M = 3.48, n = 21</p>
        )}
        {findings.map((f, i) => (
          <div key={i} className={`card border-l-4 p-3 text-sm ${TONE[f.status]}`}>
            <div className="flex justify-between gap-2">
              <code className="font-mono text-xs">{f.text}</code>
              <span className="shrink-0 text-xs font-semibold">{LABEL[f.status]}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{f.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
