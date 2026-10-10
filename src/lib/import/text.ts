/**
 * Turns HTML, JATS XML and LaTeX fragments into plain text that the statistics checks can read.
 * Pure. The goal is that "<italic>t</italic>(28) = 2.20" and "$t(28)=2.20$" both come out as "t(28) = 2.20".
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", thinsp: " ", ensp: " ", emsp: " ",
  minus: "−", ndash: "–", mdash: "—", le: "≤", ge: "≥", chi: "χ", times: "×", plusmn: "±",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const squash = (s: string) => s.replace(/[ \t   ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();

/** Inline LaTeX as found in arXiv HTML alttext and JATS <tex-math>. */
export function latexToText(tex: string): string {
  return tex
    .replace(/\\chi\s*\^\s*\{?\s*2\s*\}?/g, "χ²")
    .replace(/\\(?:leq?|leqslant)\b/g, "≤")
    .replace(/\\(?:geq?|geqslant)\b/g, "≥")
    .replace(/\\(?:lt|textless)\b/g, "<")
    .replace(/\\(?:gt|textgreater)\b/g, ">")
    .replace(/\\(?:mathit|mathrm|mathnormal|textit|textrm|text|operatorname|mathbf|textbf|emph)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:left|right|displaystyle|textstyle)\b/g, "")
    .replace(/\\(?:[,;:! ]|quad|qquad)/g, " ")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ");
}

/** For titles and abstracts: strips markup, keeps the words. */
export function inlineText(s: string): string {
  return squash(decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "));
}

const INLINE_TAGS = /<\/?(?:jats:)?(?:sup|sub|i|em|b|strong|span|italic|bold|sc|a)\b[^>]*>/gi;

/** arXiv's LaTeXML HTML: math is replaced by its LaTeX source (the alttext attribute). */
export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|head|nav|footer|svg)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<math\b[^>]*?\balttext="([^"]*)"[\s\S]*?<\/math>/gi, (_, alt: string) => ` ${latexToText(decodeEntities(alt))} `);
  s = s.replace(INLINE_TAGS, "");
  s = s.replace(/<(?:br|p|div|li|h\d|tr|td|th|section|figcaption)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  return squash(decodeEntities(s));
}

/** JATS XML (PubMed Central, Europe PMC, bioRxiv/medRxiv). References are dropped. */
export function jatsToText(xml: string): string {
  let s = xml.replace(/<(ref-list|processing-meta)\b[\s\S]*?<\/\1>/gi, " ");
  // Formulas often come twice (MathML and TeX); keep the TeX when both exist.
  s = s.replace(/<alternatives>([\s\S]*?)<\/alternatives>/gi, (m, inner: string) => {
    const tex = inner.match(/<tex-math\b[^>]*>([\s\S]*?)<\/tex-math>/i);
    return tex ? ` ${latexToText(decodeEntities(tex[1].replace(/<!\[CDATA\[|\]\]>/g, "")))} ` : inner;
  });
  s = s.replace(/<tex-math\b[^>]*>([\s\S]*?)<\/tex-math>/gi, (_, t: string) => ` ${latexToText(decodeEntities(t.replace(/<!\[CDATA\[|\]\]>/g, "")))} `);
  s = s.replace(/<\/?mml:[^>]*>/gi, "").replace(/<\/?m:[^>]*>/gi, "");
  s = s.replace(INLINE_TAGS, "");
  s = s.replace(/<(?:p|title|sec|caption|td|th|list-item)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  return squash(decodeEntities(s));
}
