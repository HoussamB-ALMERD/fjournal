import { PERIODS, buildReport } from "@/lib/report";

/** The live scrutiny report as data, for committees' own tools. ?years=3|5|10 limits the period. */
export async function GET(req: Request, ctx: RouteContext<"/api/researchers/[handle]/report">) {
  const { handle } = await ctx.params;
  const y = new URL(req.url).searchParams.get("years");
  const data = buildReport(handle, PERIODS.find((p) => String(p) === y) ?? null);
  if (!data) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(data);
}
