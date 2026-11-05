import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseCsv, validateDataset } from '../scripts/validate-dataset';

describe('parseCsv', () => {
  it('handles quotes, commas, escaped quotes and new lines inside quotes', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi""\nbye"\r\n');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"\nbye']]);
  });

  it('ignores a leading byte-order mark and blank lines', () => {
    expect(parseCsv('\uFEFFa,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('validateDataset', () => {
  const header = 'text,is_scam,scam_type,tactics,language,source,group_id,reviewed,hard_negative\n';

  it('accepts a valid scam row and a valid legitimate row', () => {
    const csv =
      header +
      '"Pay a fee now to claim your prize within 24 hours",1,lottery,fee_demand|urgency|too_good,en,synthetic,G1,no,0\n' +
      '"Your order will arrive today between 2 and 6 PM",0,none,,en,synthetic,G2,no,1\n';
    expect(validateDataset(csv).errors).toEqual([]);
  });

  it('rejects a wrong header', () => {
    expect(validateDataset('text,label\nhello,1\n').errors).toHaveLength(1);
  });

  it('reports label mistakes', () => {
    const csv =
      header +
      '"A legitimate message that has tactics listed",0,none,urgency,en,synthetic,G1,no,0\n' +
      '"A scam message that has no scam type at all",1,none,urgency,en,synthetic,G2,no,0\n' +
      '"A message with an unknown tactic inside it",1,kyc,panic,en,synthetic,G3,no,0\n';
    expect(validateDataset(csv).errors.length).toBeGreaterThanOrEqual(3);
  });

  it('warns about personal data and duplicates', () => {
    const csv =
      header +
      '"Call 9876543210 to claim your reward today",1,lottery,too_good,en,synthetic,G1,no,0\n' +
      '"Call 9876543210 to claim your reward today",1,lottery,too_good,en,synthetic,G2,no,0\n';
    const warnings = validateDataset(csv).warnings.join(' ');
    expect(warnings).toContain('phone number');
    expect(warnings).toContain('duplicate');
  });
});

describe('dataset files in the data folder', () => {
  // Same rule as the import script: names starting with dataset_ and ending in .csv,
  // in any mix of capital and small letters. Sub-folders (such as data/private) are not checked.
  const files = existsSync('data')
    ? readdirSync('data').filter((f) => /^dataset_.*\.csv$/i.test(f))
    : [];

  if (files.length === 0) {
    // Keeps the suite valid when your dataset files are stored elsewhere.
    it.skip('no dataset_*.csv files in the data folder, so nothing to check', () => {});
  }

  for (const file of files) {
    it(`${file} has no errors`, () => {
      const report = validateDataset(readFileSync(`data/${file}`, 'utf-8'));
      expect(report.errors).toEqual([]);
    });
  }
});