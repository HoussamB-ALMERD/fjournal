"use client";

import { useState } from "react";
import { parseManifest } from "@/lib/repro/manifest";

export function ManifestValidator({ example }: { example: string }) {
  const [text, setText] = useState(example);
  const result = parseManifest(text);
  return (
    <div className="space-y-3">
      <label className="label" htmlFor="manifest">Paste your fjournal.json</label>
      <textarea
        id="manifest"
        className="input min-h-80 font-mono text-xs leading-5"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {result.ok ? (
        <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Valid. The bot will run <code>{result.value.run}</code> in <code>{result.value.image}</code> and check{" "}
          {result.value.outputs.length} declared result{result.value.outputs.length === 1 ? "" : "s"}.
        </p>
      ) : (
        <ul role="alert" className="space-y-1 rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
