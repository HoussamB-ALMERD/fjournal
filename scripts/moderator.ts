/**
 * Grants or revokes the moderator role.
 *   npm run moderator -- <handle>           grant
 *   npm run moderator -- <handle> --revoke  revoke
 * Roadmap: moderators elected by high-reputation members, with term limits.
 */
import { get, run } from "../src/lib/db";

const [handle, flag] = process.argv.slice(2);
if (!handle) {
  console.error("Usage: npm run moderator -- <handle> [--revoke]");
  process.exit(1);
}
const u = get<{ id: string; role: string }>("SELECT id, role FROM users WHERE handle = ?", handle);
if (!u) {
  console.error(`No user @${handle}`);
  process.exit(1);
}
const role = flag === "--revoke" ? "member" : "moderator";
run("UPDATE users SET role = ? WHERE id = ?", role, u.id);
console.log(`@${handle} is now a ${role}.`);
