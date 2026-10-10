import { indexPublic, listIndex } from "@/lib/index/index";
import { METHOD_VERSION } from "@/lib/index/method";

/** Published assessments only. Nothing until the index is public. */
export async function GET() {
  if (!indexPublic()) return Response.json({ error: "The Journal Integrity Index is not public yet. Its method is at /journals/method." }, { status: 404 });
  return Response.json({
    kind: "fjournal.journal-index/v1",
    method_version: METHOD_VERSION,
    journals: (await listIndex(false)).map(({ journal, assessment, indicators }) => ({
      ...journal,
      assessment: { id: assessment.id, window: [assessment.window_from, assessment.window_until], method_version: assessment.method_version, published_at: assessment.published_at, published_hash: assessment.published_hash },
      indicators,
    })),
  });
}
