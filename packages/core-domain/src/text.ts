/**
 * Small, dependency-free text utilities shared by retrieval, the heuristic
 * classifier, and the context broker. They must stay deterministic: two runs
 * over the same input always produce the same tokens in the same order.
 */

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'com',
  'de',
  'for',
  'from',
  'how',
  'html',
  'http',
  'https',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'org',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'which',
  'who',
  'why',
  'with',
  'www',
  'you',
  'your',
]);

/** Latin word characters, CJK ideographs, kana, and Hangul. */
const TOKEN_RE =
  /[a-z0-9]+|[一-鿿]|[぀-ヿ]+|[가-힯]+/g;

/**
 * Tokenizes titles and paths. CJK is split per ideograph and then bigrammed by
 * `termsOf`, which is crude but works without shipping a segmenter.
 */
export function tokenize(input: string): string[] {
  const lowered = input.toLowerCase().normalize('NFKC');
  return lowered.match(TOKEN_RE) ?? [];
}

function isCjk(token: string): boolean {
  const code = token.codePointAt(0) ?? 0;
  return code >= 0x4e00 && code <= 0x9fff;
}

/** Content terms: stopwords removed, CJK characters paired into bigrams. */
export function termsOf(input: string, limit = 48): string[] {
  const tokens = tokenize(input);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (isCjk(token)) {
      const next = tokens[i + 1];
      if (next !== undefined && isCjk(next)) out.push(token + next);
      out.push(token);
      continue;
    }
    if (token.length < 2 || STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return dedupe(out).slice(0, limit);
}

export function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Jaccard-style overlap weighted toward the shorter term set. */
export function termOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let shared = 0;
  for (const term of new Set(a)) if (setB.has(term)) shared += 1;
  const denominator = Math.min(new Set(a).size, setB.size);
  return denominator === 0 ? 0 : shared / denominator;
}

/**
 * Token estimate used for context budgeting. Deliberately a cheap
 * approximation: ~4 characters per token for Latin, ~1.4 for CJK. It only has
 * to be stable and slightly pessimistic.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x2e80 && code <= 0x9fff) cjk += 1;
  }
  const latin = text.length - cjk;
  return Math.ceil(latin / 4 + cjk * 1.4);
}

/** Collapses whitespace and hard-truncates on a word boundary where possible. */
export function truncate(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}
