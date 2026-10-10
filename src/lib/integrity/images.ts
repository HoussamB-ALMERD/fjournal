import "server-only";
import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { all, run, now } from "../db";
import { safeFetchBuffer } from "./safe-fetch";
import type { Finding } from "./stats";

const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const NEAR = 6; // Hamming distance (of 64 bits) at or below which two images are "near-duplicates"

export function extractImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(\s*<?(https?:\/\/[^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) urls.add(m[1]);
  return [...urls].slice(0, MAX_IMAGES);
}

/** 64-bit difference hash: robust to rescaling, recompression and small brightness changes. */
async function dhash(img: Sharp): Promise<string> {
  const px = await img.greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] < px[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export async function fingerprint(buffer: Buffer) {
  return {
    sha256: createHash("sha256").update(buffer).digest("hex"),
    dhash: await dhash(sharp(buffer)),
    dhash_mirror: await dhash(sharp(buffer).flop()),
  };
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

type Stored = { contribution_id: string; version_seq: number; url: string; sha256: string; dhash: string; number: number };

/**
 * Fingerprints every image in a version and compares it against all images on Fjournal
 * (other contributions) and against the other images in the same version (duplicated panels).
 * Matches against the same contribution's earlier versions are expected and ignored.
 */
export async function checkImages(versionSeq: number, contributionId: string, body: string): Promise<Finding[]> {
  const urls = extractImageUrls(body);
  const findings: Finding[] = [];
  const mine: { url: string; fp: Awaited<ReturnType<typeof fingerprint>> }[] = [];

  for (const url of urls) {
    try {
      const { buffer, contentType } = await safeFetchBuffer(url, MAX_BYTES);
      if (contentType && !contentType.startsWith("image/")) throw new Error(`Not an image (${contentType}).`);
      const fp = await fingerprint(buffer);
      mine.push({ url, fp });
      run(
        `INSERT OR REPLACE INTO image_fingerprints (version_seq, contribution_id, url, sha256, dhash, dhash_mirror, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        versionSeq, contributionId, url, fp.sha256, fp.dhash, fp.dhash_mirror, now(),
      );
    } catch (e) {
      findings.push({ status: "info", text: url, message: `Could not analyse this image: ${(e as Error).message}` });
    }
  }
  if (mine.length === 0) return findings;

  // Full scan is fine at MVP scale; replace with a BK-tree or LSH index as the corpus grows.
  const others = all<Stored>(
    `SELECT f.contribution_id, f.version_seq, f.url, f.sha256, f.dhash, v.number
     FROM image_fingerprints f JOIN versions v ON v.seq = f.version_seq
     WHERE f.contribution_id <> ?`,
    contributionId,
  );

  for (const img of mine) {
    const issues: string[] = [];
    for (const o of others) {
      const where = `fj:${o.contribution_id} v${o.number}`;
      if (o.sha256 === img.fp.sha256) issues.push(`identical file to an image in ${where}`);
      else if (hamming(o.dhash, img.fp.dhash) <= NEAR) issues.push(`near-duplicate of an image in ${where}`);
      else if (hamming(o.dhash, img.fp.dhash_mirror) <= NEAR) issues.push(`mirrored copy of an image in ${where}`);
    }
    for (const other of mine) {
      if (other === img || other.url < img.url) continue; // each pair once
      if (other.fp.sha256 === img.fp.sha256 || hamming(other.fp.dhash, img.fp.dhash) <= NEAR)
        issues.push(`near-duplicate of another figure in this same version (${other.url})`);
      else if (hamming(other.fp.dhash, img.fp.dhash_mirror) <= NEAR)
        issues.push(`mirrored copy of another figure in this same version (${other.url})`);
    }
    findings.push(
      issues.length
        ? {
            status: "warn",
            text: img.url,
            message: `This image is a ${[...new Set(issues)].join("; ")}. Reuse can be legitimate (shared controls, a replication reusing a figure) but should be stated in the caption.`,
          }
        : { status: "pass", text: img.url, message: `No duplicates found among ${others.length + mine.length - 1} other images on Fjournal.` },
    );
  }
  return findings;
}
