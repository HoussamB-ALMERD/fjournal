import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, currentUser } from "@/lib/auth";
import { publicUrl, sign, unsign } from "@/lib/config";
import { get, run, now } from "@/lib/db";
import { exchangeCode } from "@/lib/orcid";

type State = { state: string; mode: "login" | "link"; next: string };

/** ORCID sends the person back here with a one-time code. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const jar = await cookies();
  const st = await unsign<State>(jar.get("fj_orcid_state")?.value);
  jar.set("fj_orcid_state", "", { path: "/auth/orcid", maxAge: 0 });

  // The state must match the one we issued, or anyone could log a victim into the attacker's account.
  if (!st || !sp.get("state") || sp.get("state") !== st.state) redirect("/login?error=orcid-state");
  const fail = (code: string) => (st.mode === "link" ? `/settings?orcid=${code}` : `/login?error=orcid-${code}`);
  const code = sp.get("code");
  if (sp.get("error") || !code) redirect(fail("cancelled"));

  let who: { orcid: string; name: string } | null = null;
  try {
    who = await exchangeCode(code, `${await publicUrl()}/auth/orcid/callback`);
  } catch (e) {
    console.error("ORCID token exchange failed", e);
  }
  if (!who) redirect(fail("failed"));

  const owner = await get<{ id: string }>("SELECT id FROM users WHERE orcid = ? AND orcid_verified_at IS NOT NULL", who.orcid);

  if (st.mode === "link") {
    const me = await currentUser();
    if (!me) redirect("/login?next=/settings");
    if (owner && owner.id !== me.id) redirect("/settings?orcid=taken");
    await run("UPDATE users SET orcid = ?, orcid_verified_at = ? WHERE id = ?", who.orcid, now(), me.id);
    redirect("/settings?orcid=linked");
  }

  if (owner) {
    await createSession(owner.id);
    redirect(st.next);
  }
  // First visit: remember the verified iD briefly and let them choose a handle.
  jar.set("fj_orcid_pending", await sign(who, 900), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 900,
  });
  redirect("/signup/orcid");
}
