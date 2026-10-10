import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { get, run, now } from "./db";
import { shortId } from "./ids";

export { hashPassword, verifyPassword } from "./password";

const COOKIE = "fj_session";
const SESSION_DAYS = 30;

export type User = {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  affiliation: string;
  orcid: string | null;
  orcid_verified_at: string | null; // set only by ORCID sign-in
  created_at: string;
};

export async function createSession(userId: string) {
  const id = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await run("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)", id, userId, expires.toISOString());
  (await cookies()).set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) await run("DELETE FROM sessions WHERE id = ?", id);
  jar.delete(COOKIE);
}

export const currentUser = cache(async (): Promise<User | null> => {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  return (
    (await get<User>(
      `SELECT u.id, u.handle, u.display_name, u.bio, u.affiliation, u.orcid, u.orcid_verified_at, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
      id,
      now(),
    )) ?? null
  );
});

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new Error("You need to sign in to do that.");
  return u;
}

export const newUserId = () => `u_${shortId(10)}`;
