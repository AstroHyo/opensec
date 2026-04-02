import { normalizeTitle } from "./canonicalize.js";

export function titleSimilarity(left: string, right: string): number {
  const a = bigrams(normalizeTitle(left));
  const b = bigrams(normalizeTitle(right));

  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (a.size + b.size);
}

function bigrams(value: string): Set<string> {
  const normalized = value.replace(/\s+/g, " ").trim();
  const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }
  return tokens;
}
