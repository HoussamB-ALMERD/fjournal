/**
 * Journal Integrity Index — sweeps run by moderators. Results are drafts until a different moderator
 * publishes them at /index/review. Nothing is public unless FJOURNAL_INDEX_PUBLIC=1.
 *
 *   npm run index -- sweep <ISSN> --field "<field>" --from 2019-01-01 --until 2021-12-31 [--sample 200] --by <moderator>
 *   npm run index -- list
 *
 * Set FJOURNAL_CONTACT_EMAIL so Crossref can reach you; sweeps make a few hundred polite requests.
 */
import { all, get } from "../src/lib/db";
import { IndexError, sweep } from "../src/lib/index/sweep";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (cmd === "list") {
  for (const r of all<{ id: string; title: string; issn: string; status: string; window_from: string; window_until: string; created_at: string }>(
    `SELECT a.id, j.title, a.issn, a.status, a.window_from, a.window_until, a.created_at
     FROM index_assessments a JOIN index_journals j ON j.issn = a.issn ORDER BY a.created_at DESC`,
  ))
    console.log(`${r.id}  ${r.status.padEnd(10)} ${r.issn}  ${r.title}  [${r.window_from} – ${r.window_until}]`);
} else if (cmd === "sweep" && rest[0]) {
  const by = flag("by");
  const mod = by ? get<{ id: string; role: string }>("SELECT id, role FROM users WHERE handle = ?", by) : undefined;
  if (!mod || mod.role !== "moderator") {
    console.error("--by must name a moderator: sweeps are attributable, and someone else must publish them.");
    process.exit(1);
  }
  try {
    const id = await sweep({
      issn: rest[0],
      field: flag("field") ?? "",
      from: flag("from") ?? "",
      until: flag("until") ?? "",
      sample: Number(flag("sample") ?? 200),
      createdBy: mod.id,
      log: (m) => console.log(m),
    });
    console.log(`\nDraft ${id}. A different moderator reviews and publishes it at /index/review.`);
  } catch (e) {
    console.error(e instanceof IndexError ? e.message : e);
    process.exit(1);
  }
} else {
  console.error('Usage:\n  npm run index -- sweep <ISSN> --field "<field>" --from YYYY-MM-DD --until YYYY-MM-DD [--sample 200] --by <moderator>\n  npm run index -- list');
  process.exit(1);
}
