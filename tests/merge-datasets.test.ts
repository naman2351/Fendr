import { describe, it, expect } from 'vitest';
import { mergeDatasets, toCsv } from '../scripts/merge-datasets.ts';
import { parseCsv, validateDataset } from '../scripts/validate-dataset.ts';

const HEADER = 'text,is_scam,scam_type,tactics,language,source,group_id,reviewed,hard_negative\n';
const scamRow = (text: string, group = 'G1', reviewed = 'no') =>
  `"${text}",1,lottery,too_good|fee_demand,en,synthetic,${group},${reviewed},0\n`;
const okRow = (text: string, group = 'G2', reviewed = 'no') =>
  `"${text}",0,none,,en,synthetic,${group},${reviewed},1\n`;

describe('mergeDatasets', () => {
  it('merges two valid files into one valid file', () => {
    const a = { name: 'a.csv', csv: HEADER + scamRow('You won a big prize, pay the fee to claim it') };
    const b = { name: 'b.csv', csv: HEADER + okRow('Your order will arrive between 2 and 6 PM today') };
    const r = mergeDatasets([a, b]);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(2);
    expect(validateDataset(r.csv).errors).toEqual([]);
  });

  it('gives group ids a file prefix so identical ids from different files stay separate', () => {
    const a = { name: 'first.csv', csv: HEADER + scamRow('You won a big prize, pay the fee to claim it', 'G1') };
    const b = { name: 'second.csv', csv: HEADER + scamRow('Instant loan approved, pay a processing fee now', 'G1') };
    const rows = parseCsv(mergeDatasets([a, b]).csv).slice(1);
    expect(rows[0][6]).toBe('first:G1');
    expect(rows[1][6]).toBe('second:G1');
  });

  it('keeps group ids unchanged with keepGroups', () => {
    const a = { name: 'a.csv', csv: HEADER + scamRow('You won a big prize, pay the fee to claim it', 'G1') };
    const b = { name: 'b.csv', csv: HEADER + okRow('Your order will arrive between 2 and 6 PM today', 'G9') };
    const rows = parseCsv(mergeDatasets([a, b], { keepGroups: true }).csv).slice(1);
    expect(rows.map((x) => x[6])).toEqual(['G1', 'G9']);
  });

  it('accepts columns in a different order and a missing hard_negative column', () => {
    const a = { name: 'a.csv', csv: HEADER + scamRow('You won a big prize, pay the fee to claim it') };
    const b = {
      name: 'b.csv',
      csv:
        'is_scam,text,scam_type,tactics,language,source,group_id,reviewed\n' +
        '0,"Your order will arrive between 2 and 6 PM today",none,,en,synthetic,G2,no\n',
    };
    const r = mergeDatasets([a, b]);
    expect(r.errors).toEqual([]);
    expect(r.notes.join(' ')).toContain('hard_negative');
    expect(parseCsv(r.csv)[2][0]).toBe('Your order will arrive between 2 and 6 PM today');
  });

  it('drops exact duplicates and prefers the reviewed copy', () => {
    const text = 'You won a big prize, pay the fee to claim it';
    const a = { name: 'a.csv', csv: HEADER + scamRow(text, 'G1', 'no') };
    const b = { name: 'b.csv', csv: HEADER + scamRow(text.toUpperCase(), 'G5', 'yes') };
    const r = mergeDatasets([a, b]);
    expect(r.rowCount).toBe(1);
    expect(r.duplicatesDropped).toBe(1);
    expect(parseCsv(r.csv)[1][7]).toBe('yes');
  });

  it('removes both copies when the same message has different labels', () => {
    const text = 'Your refund will be credited within five working days';
    const a = { name: 'a.csv', csv: HEADER + scamRow(text, 'G1') + okRow('Another perfectly normal message here', 'G3') };
    const b = { name: 'b.csv', csv: HEADER + okRow(text, 'G2') };
    const r = mergeDatasets([a, b]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toContain('a.csv');
    expect(r.conflicts[0]).toContain('b.csv');
    expect(r.rowCount).toBe(1);
  });

  it('stops and names the file when an input has errors', () => {
    const good = { name: 'good.csv', csv: HEADER + okRow('Your order will arrive between 2 and 6 PM today') };
    const bad = { name: 'bad.csv', csv: HEADER + '"Some text that is long enough",5,none,,en,synthetic,G1,no,0\n' };
    const r = mergeDatasets([good, bad]);
    expect(r.csv).toBe('');
    expect(r.errors.join(' ')).toContain('bad.csv');
  });

  it('reports a missing required column', () => {
    const a = { name: 'a.csv', csv: HEADER + okRow('Your order will arrive between 2 and 6 PM today') };
    const b = { name: 'b.csv', csv: 'text,label\nhello there friend,1\n' };
    const r = mergeDatasets([a, b]);
    expect(r.errors.join(' ')).toContain('missing column');
  });

  it('needs at least two files', () => {
    expect(mergeDatasets([{ name: 'a.csv', csv: HEADER }]).errors).toHaveLength(1);
  });
});

describe('toCsv', () => {
  it('round-trips commas, quotes and new lines', () => {
    const row = {
      text: 'He said "hello", then left.\nSecond line',
      is_scam: '0', scam_type: 'none', tactics: '', language: 'en',
      source: 'synthetic', group_id: 'G1', reviewed: 'no', hard_negative: '0',
    };
    const parsed = parseCsv(toCsv([row]));
    expect(parsed[1][0]).toBe(row.text);
  });
});