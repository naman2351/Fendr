import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Checks a ScamSaathi dataset CSV for mistakes.
 * Usage:  node scripts/validate-dataset.ts data/your-file.csv
 * Exit code is 1 if any ERROR is found (warnings do not fail the check).
 */

export const COLUMNS = [
  'text', 'is_scam', 'scam_type', 'tactics', 'language', 'source',
  'group_id', 'reviewed', 'hard_negative',
];
const SCAM_TYPES = new Set([
  'refund', 'kyc', 'job_fee', 'lottery', 'loan', 'digital_arrest', 'delivery',
  'investment', 'romance', 'other', 'none',
]);
const TACTICS = new Set([
  'urgency', 'authority', 'fee_demand', 'receive_trick', 'credential_request',
  'secrecy', 'too_good', 'fear_threat', 'impersonation',
]);
const LANGUAGES = new Set(['en', 'hi', 'hinglish']);
const SOURCES = new Set(['public', 'synthetic', 'volunteer']);

// Targets from the build guide (Phase 5).
const TARGET_PER_CLASS = 1000;
const TARGET_LANG: Record<string, number> = { en: 350, hinglish: 450, hi: 200 };
const TARGET_HARD_NEGATIVES = 300;

// Patterns that suggest personal data slipped in. These raise warnings.
const PRIVACY_PATTERNS: [string, RegExp][] = [
  ['a phone number', /(?:\+?91[\s-]?)?[6-9]\d{9}\b/],
  ['an email address or UPI ID', /\b[\w.+-]{2,}@[a-z][\w-]{1,}\b/i],
  ['a web address (use [LINK] instead)', /https?:\/\/|www\./i],
  ['a 12-digit number (Aadhaar-like)', /\b\d{4}\s?\d{4}\s?\d{4}\b/],
  ['a long digit string (card or account number)', /\d{13,19}/],
];

/** Reads CSV text into rows. Handles quotes, commas and new lines inside quotes. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export type Report = {
  errors: string[];
  warnings: string[];
  summary: string[];
};

export function validateDataset(csvText: string): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = parseCsv(csvText);

  if (rows.length === 0) {
    return { errors: ['The file is empty.'], warnings, summary: [] };
  }

  const header = rows[0].map((h) => h.trim());
  if (header.join(',') !== COLUMNS.join(',')) {
    errors.push(
      `Header must be exactly: ${COLUMNS.join(',')}\n        Found:            ${header.join(',')}`,
    );
    return { errors, warnings, summary: [] };
  }

  const seenText = new Map<string, number>();
  const groupLabels = new Map<string, Set<string>>();
  const count = { scam: 0, benign: 0, hard: 0, reviewed: 0, publicScam: 0, publicBenign: 0 };
  const byLang: Record<string, { scam: number; benign: number }> = {
    en: { scam: 0, benign: 0 },
    hinglish: { scam: 0, benign: 0 },
    hi: { scam: 0, benign: 0 },
  };
  const bySource: Record<string, number> = {};

  for (let r = 1; r < rows.length; r++) {
    const line = r + 1; // line number as shown in a spreadsheet
    const cells = rows[r];
    const where = `Row ${line}`;

    if (cells.length !== COLUMNS.length) {
      errors.push(`${where}: expected ${COLUMNS.length} columns but found ${cells.length}. A comma inside the text may be missing its quotes.`);
      continue;
    }
    const [text, isScam, scamType, tactics, language, source, groupId, reviewed, hardNegative] =
      cells.map((c) => c.trim());

    if (!text) errors.push(`${where}: text is empty.`);
    if (text && text.length < 15) warnings.push(`${where}: text is very short (${text.length} characters).`);
    if (text.length > 600) warnings.push(`${where}: text is very long (${text.length} characters).`);

    if (isScam !== '0' && isScam !== '1') errors.push(`${where}: is_scam must be 0 or 1 (found '${isScam}').`);
    if (!SCAM_TYPES.has(scamType)) errors.push(`${where}: unknown scam_type '${scamType}'.`);
    if (!LANGUAGES.has(language)) errors.push(`${where}: language must be en, hi or hinglish (found '${language}').`);
    if (!SOURCES.has(source)) errors.push(`${where}: source must be public, synthetic or volunteer (found '${source}').`);
    if (!groupId) errors.push(`${where}: group_id is empty.`);
    if (reviewed !== 'yes' && reviewed !== 'no') errors.push(`${where}: reviewed must be yes or no (found '${reviewed}').`);
    if (hardNegative !== '0' && hardNegative !== '1') errors.push(`${where}: hard_negative must be 0 or 1 (found '${hardNegative}').`);

    const tacticList = tactics ? tactics.split('|').map((t) => t.trim()) : [];
    for (const t of tacticList) {
      if (!TACTICS.has(t)) errors.push(`${where}: unknown tactic '${t}'. Separate tactics with the | symbol.`);
    }

    if (isScam === '1') {
      if (scamType === 'none') errors.push(`${where}: a scam message needs a scam_type (not 'none').`);
      if (tacticList.length === 0 && source !== 'public') warnings.push(`${where}: scam message has no tactics.`);
      if (hardNegative === '1') errors.push(`${where}: hard_negative can only be 1 for non-scam messages.`);
    }
    if (isScam === '0') {
      if (scamType !== 'none') errors.push(`${where}: a legitimate message must have scam_type 'none'.`);
      if (tacticList.length > 0) errors.push(`${where}: a legitimate message must have no tactics.`);
    }

    for (const [label, pattern] of PRIVACY_PATTERNS) {
      if (pattern.test(text)) warnings.push(`${where}: text may contain ${label}. Replace real details with placeholders such as [PHONE], [LINK] or [NAME].`);
    }

    const key = text.toLowerCase().replace(/\s+/g, ' ');
    const earlier = seenText.get(key);
    if (earlier !== undefined) warnings.push(`${where}: duplicate of row ${earlier}.`);
    else seenText.set(key, line);

    if (groupId) {
      const labels = groupLabels.get(groupId) ?? new Set<string>();
      labels.add(isScam);
      groupLabels.set(groupId, labels);
    }

    if (source === 'public') {
      if (isScam === '1') count.publicScam++;
      if (isScam === '0') count.publicBenign++;
    } else {
      if (isScam === '1') count.scam++;
      if (isScam === '0') count.benign++;
      if (hardNegative === '1') count.hard++;
      if (byLang[language] && (isScam === '0' || isScam === '1')) {
        byLang[language][isScam === '1' ? 'scam' : 'benign']++;
      }
    }
    if (reviewed === 'yes') count.reviewed++;
    bySource[source] = (bySource[source] ?? 0) + 1;
  }

  for (const [group, labels] of groupLabels) {
    if (labels.size > 1) warnings.push(`Group ${group} mixes scam and non-scam messages. Variations of one template should share a label.`);
  }

  const ownTotal = count.scam + count.benign;
  const publicTotal = count.publicScam + count.publicBenign;
  const total = ownTotal + publicTotal;
  const pct = (n: number, target: number) => `${n} of ${target} (${Math.min(100, Math.round((n / target) * 100))}%)`;
  const summary = [
    `Rows checked: ${total} (your own ${ownTotal}, public ${publicTotal})`,
    `Your own rows, scam: ${pct(count.scam, TARGET_PER_CLASS)}    legitimate: ${pct(count.benign, TARGET_PER_CLASS)}`,
    `Your own hard negatives: ${pct(count.hard, TARGET_HARD_NEGATIVES)}`,
    ...Object.entries(TARGET_LANG).map(
      ([lang, target]) => `  ${lang.padEnd(9)} scam ${pct(byLang[lang].scam, target)}, legitimate ${pct(byLang[lang].benign, target)}`,
    ),
    `Public rows (training support only): scam ${count.publicScam}, legitimate ${count.publicBenign}`,
    `Sources: ${Object.entries(bySource).map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`,
    `Reviewed by a person: ${count.reviewed} of ${total}`,
    `Groups (distinct templates): ${groupLabels.size}`,
  ];
  return { errors, warnings, summary };
}

/** Prints a list, but stops after a while so thousands of lines do not flood the screen. */
export function printLimited(items: string[], limit = 25): void {
  items.slice(0, limit).forEach((i) => console.log('  - ' + i));
  if (items.length > limit) console.log(`  ... and ${items.length - limit} more`);
}

// Command-line use. Only runs when this file is started directly, not when
// another script (like the merge tool) imports it.
function runCli(file: string | undefined): void {
  if (!file) {
    console.log('Usage: node scripts/validate-dataset.ts data/your-file.csv');
    return;
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    console.log(`Could not open '${file}'. Check the path and try again.`);
    process.exit(1);
  }
  const report = validateDataset(text);
  console.log(`\nChecking ${file}\n`);
  if (report.errors.length) {
    console.log(`ERRORS (${report.errors.length}), fix these first:`);
    printLimited(report.errors);
    console.log('');
  }
  if (report.warnings.length) {
    console.log(`WARNINGS (${report.warnings.length}), worth a look:`);
    printLimited(report.warnings);
    console.log('');
  }
  if (report.summary.length) {
    console.log('PROGRESS');
    report.summary.forEach((s) => console.log('  ' + s));
    console.log('');
  }
  console.log(report.errors.length ? 'RESULT: not ready, errors found.' : 'RESULT: no errors found.');
  process.exit(report.errors.length ? 1 : 0);
}

if (process.argv[1] && basename(process.argv[1]) === 'validate-dataset.ts') {
  runCli(process.argv[2]);
}