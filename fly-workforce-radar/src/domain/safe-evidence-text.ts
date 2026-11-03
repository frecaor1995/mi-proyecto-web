const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, token: string) => {
    if (token[0] !== "#") return NAMED_ENTITIES[token.toLowerCase()] ?? entity;
    const hexadecimal = token[1]?.toLowerCase() === "x";
    const point = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(point) || point < 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return "�";
    return String.fromCodePoint(point);
  });
}

/**
 * Converts provider-controlled excerpts to readable plain text. Decoding is
 * intentionally bounded before tag removal so encoded markup cannot become
 * executable markup. React receives an ordinary string and escapes it again
 * at render time; this helper is never an HTML sanitizer or rendering API.
 */
export function toSafeEvidenceText(value: string | null | undefined): string | null {
  if (value == null) return null;
  let text = value;
  for (let pass = 0; pass < 2; pass += 1) text = decodeHtmlEntities(text);
  text = text.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ");
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
