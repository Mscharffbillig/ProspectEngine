// Minimal mirror of the worker's normalize_company_name (services/research-worker/
// worker/normalize.py). The worker owns all normalization; this exists only for
// the one case the worker can't cover — an operator-corrected business name is
// marked name_confidence='manual', which the worker deliberately never touches,
// so the web app must refresh the dedup key (normalized_name) itself. Keep the
// two in sync if the Python version changes.
const NAME_SUFFIXES = new Set([
  "llc",
  "inc",
  "incorporated",
  "company",
  "co",
  "corporation",
  "corp",
  "ltd",
  "llp",
  "lp",
  "pllc",
  "pc",
]);

export function normalizeCompanyName(name: string): string {
  let cleaned = name.toLowerCase().replaceAll(".", "");
  cleaned = cleaned.replace(/[^\w\s&']/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  while (words.length && NAME_SUFFIXES.has(words[words.length - 1]!)) {
    words.pop();
  }
  return words.join(" ");
}
