const legalSuffixes = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
]);

export function normalizeCompanyName(value: string): string {
  const tokens = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && legalSuffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export function isUnresolvedPlaceholder(value: string): boolean {
  const normalized = normalizeCompanyName(value);
  return new Set([
    "unknown", "unknown client", "client undisclosed", "undisclosed client",
    "confidential client", "confidential", "undisclosed", "n a", "na",
  ]).has(normalized);
}
