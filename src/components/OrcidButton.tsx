/** A plain link, so ORCID sign-in works without JavaScript. */
export function OrcidButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="btn-ghost flex w-full items-center justify-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#a6ce39] text-[10px] font-bold text-white">iD</span>
      {children}
    </a>
  );
}

export const ORCID_MESSAGES: Record<string, string> = {
  "orcid-unavailable": "ORCID sign-in isn't configured on this Fjournal instance yet.",
  "orcid-state": "That sign-in link was stale or tampered with. Please try again.",
  "orcid-cancelled": "ORCID sign-in was cancelled.",
  "orcid-failed": "ORCID couldn't confirm the sign-in. Please try again.",
};
