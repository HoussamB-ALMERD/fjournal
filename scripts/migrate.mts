/**
 * Applies pending schema migrations. Runs on every Vercel build (see `vercel-build` in package.json),
 * over the direct connection (DATABASE_URL_UNPOOLED) when one is set, as Neon recommends.
 *   npm run migrate
 */
import { closeDb, migrate } from "../src/lib/db";

await migrate((m) => console.log(m), { useDirect: true });
console.log("Database schema is up to date.");
await closeDb();
