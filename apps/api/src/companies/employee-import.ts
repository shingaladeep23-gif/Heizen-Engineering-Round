// CSV import of a company's employees (spec 4.5): good rows are imported,
// bad rows are reported with a reason, and the file is never rejected whole.
// Pure, so the rules can be tested without a database.

export type ImportRow = {
  row: number; // line number in the file, as people count (header = 1)
  name: string;
  email: string;
  canChooseAddress: boolean;
  canChangeTime: boolean;
  canChangePackaging: boolean;
  allergyIds: number[];
  dietaryIds: number[];
};
export type RowError = { row: number; email: string; problems: string[] };

/** Splits CSV text into rows of cells. Handles quotes ("Rao, Kavya") and "" inside them. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows;
}

const YES = ['yes', 'y', 'true', '1'];
const NO = ['no', 'n', 'false', '0', ''];

export function checkRows(
  text: string,
  ctx: {
    domains: string[];
    existingEmails: Set<string>;
    allergens: Map<string, number>; // lower-cased name -> id
    dietaryTags: Map<string, number>;
  },
): { rows: ImportRow[]; errors: RowError[] } {
  const [header = [], ...lines] = parseCsv(text.replace(/^﻿/, '')); // Excel adds a BOM
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const at = {
    name: col('name'),
    email: col('email'),
    address: col('can_choose_address'),
    time: col('can_change_time'),
    packaging: col('can_change_packaging'),
    allergies: col('allergies'),
    dietary: col('dietary'),
  };
  if (at.name < 0 || at.email < 0) {
    return {
      rows: [],
      errors: [
        { row: 1, email: '', problems: ['The first row must have "name" and "email" columns'] },
      ],
    };
  }

  const rows: ImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  lines.forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => c.trim() === '')) return; // blank line
    const get = (index: number) => (index < 0 ? '' : (cells[index] ?? '').trim());
    const problems: string[] = [];
    const name = get(at.name);
    const email = get(at.email).toLowerCase();

    if (!name) problems.push('Name is missing');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('Not a valid email');
    else if (!ctx.domains.includes(email.split('@')[1])) {
      problems.push(`Email must be at ${ctx.domains.map((d) => `@${d}`).join(' or ')}`);
    } else if (ctx.existingEmails.has(email)) problems.push('Already an employee');
    else if (seen.has(email)) problems.push('Same email earlier in the file');

    const flag = (index: number, label: string) => {
      const value = get(index).toLowerCase();
      if (YES.includes(value)) return true;
      if (!NO.includes(value)) problems.push(`${label} should be yes or no`);
      return false;
    };
    const names = (index: number, list: Map<string, number>, label: string) =>
      get(index)
        .split(';')
        .map((n) => n.trim())
        .filter(Boolean)
        .flatMap((n) => {
          const id = list.get(n.toLowerCase());
          if (id === undefined) problems.push(`Unknown ${label} "${n}"`);
          return id === undefined ? [] : [id];
        });

    const parsed = {
      row,
      name,
      email,
      canChooseAddress: flag(at.address, 'can_choose_address'),
      canChangeTime: flag(at.time, 'can_change_time'),
      canChangePackaging: flag(at.packaging, 'can_change_packaging'),
      allergyIds: names(at.allergies, ctx.allergens, 'allergy'),
      dietaryIds: names(at.dietary, ctx.dietaryTags, 'dietary tag'),
    };
    if (problems.length) errors.push({ row, email, problems });
    else {
      rows.push(parsed);
      seen.add(email);
    }
  });
  return { rows, errors };
}
