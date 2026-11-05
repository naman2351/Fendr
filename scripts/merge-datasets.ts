import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { COLUMNS, parseCsv, printLimited, validateDataset } from './validate-dataset.ts';

/**
 * Merges two or more ScamSaathi dataset CSVs into one clean file.
 *
 * Usage:
 *   node scripts/merge-datasets.ts data/a.csv data/b.csv
 *   node scripts/merge-datasets.ts data/a.csv data/b.csv --out data/dataset_merged.csv
 *
 * Options:
 *   --out <path>     where to write the result (default: data/dataset_merged_<today>.csv)
 *   --keep-groups    keep group_id values exactly as they are (default: add the file
 *                    name in front, so G1 in one file never collides with G1 in another)
 *   --overwrite      allow replacing an existing output file
 *
 * What it does:
 *   1. Checks every input file on its own and stops if any has errors.
 *   2. Accepts columns in any order, and a missing hard_negative column (set to 0).
 *   3. Drops exact duplicate messages. If a duplicate has the same label, one copy
 *      is kept (the human-reviewed one if there is a choice).
 *   4. If the same message is labeled differently in two files, BOTH copies are
 *      removed and listed, so you can decide which label is right.
 *   5. Checks the merged result before writing it.
 */

const REQUIRED = COLUMNS.filter((c) => c !== 'hard_negative');

type Row = Record<string, string>;

export type MergeInput = { name: string; csv: string };
export type MergeOptions = { keepGroups?: boolean };
export type MergeResult = {
  csv: string; // empty when errors stop the merge
  rowCount: number;
  errors: string[];
  notes: string[];
  conflicts: string[];
  duplicatesDropped: number;
  perFile: { name: string; rows: number; kept: number }[];
  summary: string[];
  warnings: string[];
};

function csvField(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? '"' + value.replace(/"/g, '""') + '"'
    : value;
}

export function toCsv(rows: Row[]): string {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvField(row[c] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stem(name: string): string {
  return basename(name, extname(name)).replace(/[^A-Za-z0-9_-]+/g, '_');
}

/** Reads one file into rows with the standard columns, in any column order. */
function readRows(input: MergeInput, errors: string[], notes: string[]): Row[] {
  const table = parseCsv(input.csv);
  if (table.length === 0) {
    errors.push(`${input.name}: the file is empty.`);
    return [];
  }
  const header = table[0].map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    errors.push(`${input.name}: missing column(s): ${missing.join(', ')}.`);
    return [];
  }
  const extras = header.filter((h) => !COLUMNS.includes(h));
  if (extras.length) notes.push(`${input.name}: ignored extra column(s): ${extras.join(', ')}.`);
  if (!header.includes('hard_negative')) {
    notes.push(`${input.name}: no hard_negative column, so every row was set to 0.`);
  }

  const rows: Row[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    if (cells.length !== header.length) {
      errors.push(
        `${input.name}: row ${r + 1} has ${cells.length} columns but the header has ${header.length}. A comma inside the text may be missing its quotes.`,
      );
      continue;
    }
    const row: Row = {};
    header.forEach((h, i) => {
      if (COLUMNS.includes(h)) row[h] = cells[i].trim();
    });
    if (!header.includes('hard_negative')) row['hard_negative'] = '0';
    rows.push(row);
  }
  return rows;
}

export function mergeDatasets(inputs: MergeInput[], options: MergeOptions = {}): MergeResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const conflicts: string[] = [];
  const empty: MergeResult = {
    csv: '', rowCount: 0, errors, notes, conflicts, duplicatesDropped: 0,
    perFile: [], summary: [], warnings: [],
  };

  if (inputs.length < 2) {
    errors.push('Give at least two files to merge.');
    return empty;
  }

  // Step 1: read and check each file on its own.
  const loaded: { name: string; rows: Row[] }[] = [];
  for (const input of inputs) {
    const rows = readRows(input, errors, notes);
    loaded.push({ name: input.name, rows });
    if (rows.length > 0) {
      const own = validateDataset(toCsv(rows));
      own.errors.forEach((e) => errors.push(`${input.name}: ${e}`));
    }
  }
  if (errors.length) return empty;

  // Step 2: merge, with group namespacing and duplicate handling.
  type Kept = { row: Row; file: string; line: number; removed: boolean };
  const byText = new Map<string, Kept>();
  const order: Kept[] = [];
  const perFile = loaded.map((f) => ({ name: f.name, rows: f.rows.length, kept: 0 }));
  let duplicatesDropped = 0;

  loaded.forEach((file) => {
    file.rows.forEach((row, i) => {
      const line = i + 2;
      const merged: Row = { ...row };
      if (!options.keepGroups) merged['group_id'] = `${stem(file.name)}:${row['group_id']}`;

      const key = normalizeText(row['text']);
      const earlier = byText.get(key);
      if (!earlier) {
        const entry: Kept = { row: merged, file: file.name, line, removed: false };
        byText.set(key, entry);
        order.push(entry);
        return;
      }
      if (earlier.removed) {
        duplicatesDropped++;
        return;
      }
      if (earlier.row['is_scam'] !== row['is_scam']) {
        const label = (v: string) => (v === '1' ? 'a scam' : 'legitimate');
        conflicts.push(
          `"${row['text'].slice(0, 70)}${row['text'].length > 70 ? '...' : ''}" is ${label(earlier.row['is_scam'])} in ${earlier.file} (row ${earlier.line}) but ${label(row['is_scam'])} in ${file.name} (row ${line}).`,
        );
        earlier.removed = true;
        duplicatesDropped++;
        return;
      }
      duplicatesDropped++;
      if (earlier.row['reviewed'] !== 'yes' && row['reviewed'] === 'yes') {
        earlier.row = merged;
        earlier.file = file.name;
        earlier.line = line;
      }
    });
  });

  const finalRows = order.filter((e) => !e.removed).map((e) => e.row);
  for (const e of order) {
    if (e.removed) continue;
    const f = perFile.find((p) => p.name === e.file);
    if (f) f.kept++;
  }

  // Step 3: check the merged result.
  const csv = toCsv(finalRows);
  const report = validateDataset(csv);
  if (report.errors.length) {
    report.errors.forEach((e) => errors.push(`merged result: ${e}`));
    return { ...empty, errors };
  }
  return {
    csv,
    rowCount: finalRows.length,
    errors,
    notes,
    conflicts,
    duplicatesDropped,
    perFile,
    summary: report.summary,
    warnings: report.warnings,
  };
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function runCli(args: string[]): void {
  const files: string[] = [];
  let out = `data/dataset_merged_${today()}.csv`;
  let keepGroups = false;
  let overwrite = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out = args[++i] ?? out;
    else if (a === '--keep-groups') keepGroups = true;
    else if (a === '--overwrite') overwrite = true;
    else files.push(a);
  }
  if (files.length < 2) {
    console.log('Usage: node scripts/merge-datasets.ts data/a.csv data/b.csv [--out path] [--keep-groups] [--overwrite]');
    process.exit(1);
  }

  const inputs: MergeInput[] = [];
  for (const f of files) {
    try {
      inputs.push({ name: basename(f), csv: readFileSync(f, 'utf-8') });
    } catch {
      console.log(`Could not open '${f}'. Check the path and try again.`);
      process.exit(1);
    }
  }

  const result = mergeDatasets(inputs, { keepGroups });
  if (result.errors.length) {
    console.log('\nCannot merge yet. Fix these in the original files first:\n');
    printLimited(result.errors);
    process.exit(1);
  }
  if (existsSync(out) && !overwrite) {
    console.log(`\n'${out}' already exists. Pick another name with --out, or add --overwrite to replace it.`);
    process.exit(1);
  }

  writeFileSync(out, '\uFEFF' + result.csv, 'utf-8');

  console.log(`\nMerged ${files.length} files into ${out}\n`);
  result.perFile.forEach((f) => console.log(`  ${f.name}: ${f.rows} rows read, ${f.kept} kept`));
  console.log(`\n  Duplicates dropped: ${result.duplicatesDropped}`);
  console.log(`  Final rows: ${result.rowCount}\n`);
  if (result.notes.length) {
    console.log('NOTES');
    printLimited(result.notes);
    console.log('');
  }
  if (result.conflicts.length) {
    console.log(`CONFLICTS (${result.conflicts.length}): the same message has different labels. Both copies were removed. Decide the right label and add it back by hand:`);
    printLimited(result.conflicts);
    console.log('');
  }
  if (result.warnings.length) {
    console.log(`WARNINGS (${result.warnings.length}), worth a look:`);
    printLimited(result.warnings);
    console.log('');
  }
  console.log('PROGRESS');
  result.summary.forEach((s) => console.log('  ' + s));
  console.log('\nRESULT: merged file written and checked.');
}

if (process.argv[1] && basename(process.argv[1]) === 'merge-datasets.ts') {
  runCli(process.argv.slice(2));
}