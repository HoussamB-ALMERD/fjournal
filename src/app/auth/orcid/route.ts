import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { publicUrl, sign } from "@/lib/config";
import { authorizeUrl, orcidConfig } from "@/lib/orcid";

const STATE_COOKIE = "fj_orcid_state";

/** Starts ORCID sign-in. ?mode=login (default) signs in or signs up; ?mode=link connects an iD to the current account. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("mode") === "link" ? "link" : "login";
  const rawNext = sp.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  if (!orcidConfig()) redirect(mode === "link" ? "/settings?orcid=unavailable" : "/login?error=orcid-unavailable");
  if (mode === "link" && !(await currentUser())) redirect("/login?next=/settings");

  const state = randomBytes(16).toString("base64url");
  (await cookies()).set(STATE_COOKIE, await sign({ state, mode, next }, 600), {
    httpOnly: true,
    sameSite: "lax", // sent on the top-level redirect back from orcid.org
    secure: process.env.NODE_ENV === "production",
    path: "/auth/orcid",
    maxAge: 600,
  });
  redirect(authorizeUrl(state, `${await publicUrl()}/auth/orcid/callback`));
}
