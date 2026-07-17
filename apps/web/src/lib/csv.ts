// Minimal RFC 4180 CSV parsing + header mapping for the import preview.
// Row-level normalization/dedup happens in the Python worker, not here.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  company_name: "company_name",
  company: "company_name",
  name: "company_name",
  business: "company_name",
  business_name: "company_name",
  website: "website",
  url: "website",
  domain: "website",
  phone: "phone",
  phone_number: "phone",
  city: "city",
  state: "state",
  industry: "industry",
  category: "industry",
  contact_name: "contact_name",
  contact: "contact_name",
  email: "email",
  email_address: "email",
  source: "source",
};

export function mapHeaders(headerRow: string[]): (string | null)[] {
  return headerRow.map((raw) => {
    const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
    return HEADER_ALIASES[key] ?? null;
  });
}

export function rowsToObjects(rows: string[][]): {
  records: Record<string, string>[];
  unmappedHeaders: string[];
} {
  const headerRow = rows[0] ?? [];
  const mapping = mapHeaders(headerRow);
  const unmappedHeaders = headerRow.filter((_, i) => mapping[i] === null);
  const records = rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    mapping.forEach((field, i) => {
      if (field !== null) record[field] = (row[i] ?? "").trim();
    });
    return record;
  });
  return { records, unmappedHeaders };
}
