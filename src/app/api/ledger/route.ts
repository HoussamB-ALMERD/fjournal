import { all } from "@/lib/db";
import { GENESIS, verifyLedger } from "@/lib/ledger";

/** Full ledger export so anyone can mirror and independently verify the chain. */
export async function GET() {
  const entries = all<{
    seq: number;
    contribution_id: string;
    number: number;
    content_hash: string;
    prev_chain_hash: string;
    chain_hash: string;
    created_at: string;
  }>("SELECT seq, contribution_id, number, content_hash, prev_chain_hash, chain_hash, created_at FROM versions ORDER BY seq ASC");
  // Reviews have their own chain: chain_hash = sha256("review|" + prev|content_hash|review_id|created_at).
  const review_entries = all<{ seq: number; review_id: string; content_hash: string; prev_chain_hash: string; chain_hash: string; created_at: string }>(
    "SELECT seq, review_id, content_hash, prev_chain_hash, chain_hash, created_at FROM review_ledger ORDER BY seq ASC",
  );
  // Board changes and editorial decisions: chain_hash = sha256("collection|" + prev|content_hash|created_at).
  const collection_entries = all<{ seq: number; collection_id: string; kind: string; content_hash: string; prev_chain_hash: string; chain_hash: string; created_at: string }>(
    "SELECT seq, collection_id, kind, content_hash, prev_chain_hash, chain_hash, created_at FROM collection_log ORDER BY seq ASC",
  );
  return Response.json({
    kind: "fjournal.ledger/v1",
    collection_head: collection_entries.at(-1)?.chain_hash ?? GENESIS,
    collection_entries,
    review_head: review_entries.at(-1)?.chain_hash ?? GENESIS,
    review_entries,
    genesis: GENESIS,
    head: entries.at(-1)?.chain_hash ?? GENESIS,
    verification: verifyLedger(),
    generated_at: new Date().toISOString(),
    entries,
  });
}
