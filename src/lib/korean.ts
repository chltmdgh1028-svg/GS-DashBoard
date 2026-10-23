/**
 * 가나다순 (Korean alphabetical) ordering: Hangul ㄱ → ㅎ first, then Latin,
 * then digits, as a printed Korean directory does.
 *
 * `Intl.Collator("ko")` orders within a script. What it cannot know is that "(주)엘제이농산" belongs
 * under ㅇ-ㄹ, not under the parenthesis. Company names carry a legal form
 * ("(주)", "㈜", "영농조합법인", ...) that nobody scans a supplier list by, so
 * ordering uses the name with those forms removed. The original name is what
 * is displayed; only the sort key is normalised.
 *
 * ponytail: a fixed list of legal forms. A new form just sorts by its first
 * character until it is added here.
 */
const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/**
 * Script of the first character: Hangul, then Latin, then digits, then the
 * rest. Fixed here rather than left to the collator because where Latin falls
 * relative to Hangul depends on the ICU data a given browser ships with, and a
 * supplier list must not reorder between machines.
 */
function scriptRank(text: string): number {
  const code = text.trim().charCodeAt(0);
  if (Number.isNaN(code)) return 4;
  if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3131 && code <= 0x318e)) return 0;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 1;
  if (code >= 0x30 && code <= 0x39) return 2;
  return 3;
}

export const compareKo = (a: string, b: string) => scriptRank(a) - scriptRank(b) || collator.compare(a, b);

/** Longest first, so "농업회사법인" is removed before a shorter prefix could match. */
const LEGAL_FORMS = [
  "농업회사법인",
  "영농조합법인",
  "농업법인",
  "주식회사",
  "유한회사",
  "(주)",
  "(유)",
  "(사)",
  "(합)",
].sort((a, b) => b.length - a.length);

/** The key a supplier is ordered by: NFKC-folded (㈜ → (주)), legal forms and spaces removed. */
export function sortName(name: string): string {
  const folded = name.normalize("NFKC").trim();
  let key = folded;
  for (let pass = 0; pass < 3; pass += 1) {
    const before = key;
    for (const form of LEGAL_FORMS) {
      if (key.startsWith(form)) key = key.slice(form.length).trimStart();
      if (key.endsWith(form)) key = key.slice(0, key.length - form.length).trimEnd();
    }
    if (key === before) break;
  }
  key = key.replace(/\s+/g, "");
  // A name that is nothing but a legal form must still sort somewhere sensible.
  return key || folded;
}

/** Compare two supplier names by their sort key; blank names always go last. */
export function compareSupplier(a: string, b: string, direction: "asc" | "desc" = "asc"): number {
  const blankA = a.trim() === "";
  const blankB = b.trim() === "";
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  const result = compareKo(sortName(a), sortName(b)) || compareKo(a, b);
  return direction === "asc" ? result : -result;
}
