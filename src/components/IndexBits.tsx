import type { Proportion } from "@/lib/index/method";

const pct = (x: number, scale: number) => (scale === 100 ? `${(x * 100).toFixed(1)}%` : (x * scale).toFixed(1));

/** A proportion always shown with its interval and its sample; never a bare number. */
export function Prop({ p, scale = 100, unit = "" }: { p: Proportion | null; scale?: number; unit?: string }) {
  if (!p) return <span className="text-muted">no baseline yet</span>;
  if ("insufficient" in p)
    return (
      <span className="text-muted" title="Below the minimum sample, no figure is shown">
        insufficient data (n = {p.n.toLocaleString("en")})
      </span>
    );
  return (
    <span>
      <strong>{pct(p.p, scale)}{unit}</strong>{" "}
      <span className="text-muted">
        (95% CI {pct(p.lo, scale)}–{pct(p.hi, scale)}{unit}; {p.k.toLocaleString("en")} of {p.n.toLocaleString("en")})
      </span>
    </span>
  );
}

/** Compact form for tables. */
export function PropCell({ p, scale = 100 }: { p: Proportion; scale?: number }) {
  if ("insufficient" in p) return <span className="text-muted" title={`n = ${p.n}: below the minimum sample`}>–</span>;
  return (
    <span title={`95% CI ${pct(p.lo, scale)}–${pct(p.hi, scale)}; ${p.k} of ${p.n}`}>
      {pct(p.p, scale)}
      <span className="block text-[10px] text-muted">{pct(p.lo, scale)}–{pct(p.hi, scale)}</span>
    </span>
  );
}

export function PreviewBanner({ notPublic, draft }: { notPublic: boolean; draft?: boolean }) {
  if (!notPublic && !draft) return null;
  return (
    <div className="rounded-md border-2 border-amber-500/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {notPublic && (
        <>
          <strong>Preview, visible to moderators only.</strong> The Journal Integrity Index is not public until its method has
          been reviewed by research-integrity researchers and its publication checked by a lawyer (then set
          FJOURNAL_INDEX_PUBLIC=1).{" "}
        </>
      )}
      {draft && <>This assessment is a <strong>draft</strong>: a second moderator must check it before it can be published.</>}
    </div>
  );
}
