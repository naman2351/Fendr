import { describe,it,expect } from 'vitest';
import {
  parseLabel,
  parseSentinelCsv,
  parseBolewaraJson,
  scrub,
  emptyScrubCounts,
  detectLanguage,
  guessScamType,
  clusterTemplates,
  processOrigin,
  runPipeline,
  DEFAULT_OPTIONS,
} from '../scripts/import-public.ts';
import type { BuildOptions, ParseResult } from '../scripts/import-public.ts';
import { validateDataset } from '../scripts/validate-dataset.ts';

const HEADER = 'text,is_scam,scam_type,tactics,language,source,group_id,reviewed,hard_negative\n';
const OWN_CSV =
  HEADER +
  '"Pay a fee now to claim your prize within 24 hours",1,lottery,fee_demand|urgency|too_good,en,synthetic,S01,no,0\n' +
  '"Your order will arrive today between 2 and 6 PM",0,none,,en,synthetic,B01,no,1\n';

describe('parseLabel', () => {
  it('understands numbers, words and booleans', () => {
    expect(parseLabel(1)).toBe(1);
    expect(parseLabel('0')).toBe(0);
    expect(parseLabel('Spam')).toBe(1);
    expect(parseLabel('ham')).toBe(0);
    expect(parseLabel(true)).toBe(1);
    expect(parseLabel('maybe')).toBeNull();
    expect(parseLabel(7)).toBeNull();
    expect(parseLabel(undefined)).toBeNull();
  });
});

describe('parseSentinelCsv', () => {
  it('reads the Shade63 layout (id, text, label, category, category_name)', () => {
    const csv =
      'id,text,label,category,category_name\n' +
      '1,"Your OTP is 482913. Do not share it.",0,0,legit\n' +
      '2,"CBI officer here, you are under arrest",1,1,government_impersonation\n';
    const r = parseSentinelCsv(csv);
    expect(r.records).toHaveLength(2);
    expect(r.records[1]).toEqual({ text: 'CBI officer here, you are under arrest', label: 1, category: 'government_impersonation' });
  });

  it('falls back to the numeric category when there is no name column', () => {
    const r = parseSentinelCsv('text,label,category\n"Update your KYC now or be blocked",1,3\n');
    expect(r.records[0].category).toBe('bank_phishing');
  });

  it('works with only text and label, and says categories are missing', () => {
    const r = parseSentinelCsv('text,label\n"Update your KYC now or be blocked",1\n');
    expect(r.records).toHaveLength(1);
    expect(r.notes.join(' ')).toContain('no category');
  });

  it('skips unreadable rows and explains a missing text column', () => {
    expect(parseSentinelCsv('text,label\n"",1\n"Some message here",maybe\n').skipped).toBe(2);
    expect(parseSentinelCsv('message,label\nhi,1\n').notes.join(' ')).toContain("No 'text' column");
  });
});

describe('parseBolewaraJson', () => {
  const rows = [{ text: 'Lol u still feeling sick?', label: 0 }, { text: 'Win a prize now, send the fee', label: 1 }];

  it('reads { rows: [...] }, the real layout', () => {
    expect(parseBolewaraJson(JSON.stringify({ rows })).records).toHaveLength(2);
  });
  it('reads a plain list', () => {
    expect(parseBolewaraJson(JSON.stringify(rows)).records).toHaveLength(2);
  });
  it('reads the Hugging Face { rows: [{ row: {...} }] } layout', () => {
    expect(parseBolewaraJson(JSON.stringify({ rows: rows.map((row) => ({ row })) })).records).toHaveLength(2);
  });
  it('reads JSON Lines', () => {
    const r = parseBolewaraJson(rows.map((x) => JSON.stringify(x)).join('\n'));
    expect(r.records).toHaveLength(2);
  });
  it('explains unreadable input instead of crashing', () => {
    expect(parseBolewaraJson('not json at all').notes.join(' ')).toContain('Could not read');
    expect(parseBolewaraJson('{"hello": 1}').records).toHaveLength(0);
  });
});

describe('scrub', () => {
  it('replaces links, including ones glued to a word and bare domains', () => {
    expect(scrub('Open http://evil.example/login now')).toBe('Open [LINK] now');
    expect(scrub('experiencehttp://www.example.co.uk/text')).toBe('experience[LINK]');
    expect(scrub('Reset now at axis-reset.net to avoid lockout')).toBe('Reset now at [LINK] to avoid lockout');
  });

  it('replaces emails and UPI IDs', () => {
    expect(scrub('Mail help@example.com or pay ravi@oksbi today')).toBe('Mail [EMAIL] or pay [UPI_ID] today');
  });

  it('replaces phone numbers, including spaced and +91 forms', () => {
    expect(scrub('Call 9876543210')).toBe('Call [PHONE]');
    expect(scrub('Call +91 98765 43210 now')).toBe('Call [PHONE] now');
    expect(scrub('Call 1800 123 4567')).toBe('Call [PHONE]');
    expect(scrub('Call 09061701461 now')).toBe('Call [PHONE] now');
  });

  it('does not mistake transaction codes for phone numbers', () => {
    expect(scrub('Txn ref: TXN7721476160. Balance Rs 500')).toBe('Txn ref: TXN[NUMBER]. Balance Rs 500');
  });

  it('replaces Aadhaar-like and long numbers but keeps OTPs and amounts', () => {
    expect(scrub('Aadhaar 1234 5678 9012 linked')).toBe('Aadhaar [NUMBER] linked');
    expect(scrub('Card 4111111111111111 blocked')).toBe('Card [NUMBER] blocked');
    expect(scrub('OTP 482913 for Rs 25,00,000 and ₹4,999')).toBe('OTP 482913 for Rs 25,00,000 and ₹4,999');
  });

  it('counts what it replaced and tidies spaces and control characters', () => {
    const counts = emptyScrubCounts();
    expect(scrub('Call\u0000 9876543210   or  visit www.x.com', counts)).toBe('Call [PHONE] or visit [LINK]');
    expect(counts.phone).toBe(1);
    expect(counts.link).toBe(1);
  });
});

describe('detectLanguage', () => {
  it('tells English, Hindi and Hinglish apart', () => {
    expect(detectLanguage('Your account will be blocked today, update KYC now')).toBe('en');
    expect(detectLanguage('आपका खाता आज बंद हो जाएगा, तुरंत KYC अपडेट करें')).toBe('hi');
    expect(detectLanguage('Aapka account aaj block ho jayega, abhi KYC update karein')).toBe('hinglish');
  });
  it('does not call ordinary English Hinglish because of one shared word', () => {
    expect(detectLanguage('Your account has been credited with 500 rupees')).toBe('en');
  });
});

describe('guessScamType', () => {
  it('does not read "investigation" as an investment scam', () => {
    expect(guessScamType('Inspector Rao from Interpol is conducting this investigation', 'financial_fraud')).toBe('digital_arrest');
  });
  it('uses the category to narrow down', () => {
    expect(guessScamType('Update your KYC at once', 'bank_phishing')).toBe('kyc');
    expect(guessScamType('Your password was reset', 'bank_phishing')).toBe('other');
    expect(guessScamType('You won the KBC lottery, pay a fee', 'financial_fraud')).toBe('lottery');
    expect(guessScamType('Join our crypto group for guaranteed returns', 'financial_fraud')).toBe('investment');
    expect(guessScamType('Your parcel is held at customs, pay a fee', 'romance_parcel_sextortion')).toBe('delivery');
    expect(guessScamType('Income Tax refund approved, verify details', 'government_impersonation')).toBe('refund');
  });
  it('guesses from keywords alone when there is no category', () => {
    expect(guessScamType('Instant loan approved, pay the processing fee')).toBe('loan');
    expect(guessScamType('Nothing recognisable in this message at all')).toBe('other');
  });
});

describe('clusterTemplates', () => {
  it('puts near-identical messages together and keeps different ones apart', () => {
    const texts = [
      'SBI Fraud Alert: A Rs 40,000 transaction on your account ending 3421 is suspicious. Call now to block it',
      'SBI Fraud Alert: A Rs 55,000 transaction on your account ending 9912 is suspicious. Call now to block it',
      'HDFC Fraud Alert: A Rs 12,000 transaction on your account ending 1100 is suspicious. Call now to block it',
      'Congratulations you have won a lucky draw prize, pay a small fee to claim your reward today',
    ];
    const c = clusterTemplates(texts);
    expect(c[0]).toBe(c[1]);
    expect(c[0]).toBe(c[2]);
    expect(c[3]).not.toBe(c[0]);
  });
});

/** Builds a fake source with many near-identical messages per template. */
function fakeSource(): ParseResult {
  const records: ParseResult['records'] = [];
  for (let i = 0; i < 30; i++) {
    records.push({ text: `SBI Fraud Alert: A Rs ${40000 + i} transaction on account ending ${3000 + i} looks suspicious. Call now to block it`, label: 1, category: 'bank_phishing' });
    records.push({ text: `This is Officer ${i} from the CBI. Your Aadhaar is linked to a drug case and you will be arrested today`, label: 1, category: 'government_impersonation' });
    records.push({ text: `Your electricity bill of Rs ${900 + i} for October is generated. Pay through the official app by 15-11-26`, label: 0, category: 'legit' });
  }
  for (let i = 0; i < 5; i++) {
    records.push({ text: `Aapka account ${i} aaj block ho jayega, abhi KYC update karein warna band ho jayega`, label: 1, category: 'bank_phishing' });
  }
  return { records, skipped: 0, notes: [] };
}

describe('processOrigin', () => {
  const options: BuildOptions = { ...DEFAULT_OPTIONS, perTemplate: 2, caps: { sentinel: { scam: 1, legit: 1 }, bolewara: { scam: 1, legit: 1 } } };

  it('keeps at most a few rows per template and gives each template one group id', () => {
    const r = processOrigin('sentinel', fakeSource(), { ...options, caps: { ...options.caps, sentinel: { scam: 99, legit: 99 } } });
    const english = r.rows.filter((x) => x['language'] === 'en');
    expect(english.length).toBeLessThanOrEqual(6); // 3 templates x 2
    expect(new Set(english.map((x) => x['group_id'])).size).toBe(3);
    expect(r.rows.every((x) => x['group_id'].startsWith('sentinel-t'))).toBe(true);
  });

  it('applies class caps to English rows but never cuts Hinglish', () => {
    const r = processOrigin('sentinel', fakeSource(), options);
    const english = r.rows.filter((x) => x['language'] === 'en');
    expect(english.filter((x) => x['is_scam'] === '1')).toHaveLength(1);
    expect(english.filter((x) => x['is_scam'] === '0')).toHaveLength(1);
    expect(r.rows.some((x) => x['language'] === 'hinglish')).toBe(true);
  });

  it('fills the standard columns for public rows', () => {
    const r = processOrigin('bolewara', fakeSource(), { ...options, caps: { ...options.caps, bolewara: { scam: 9, legit: 9 } } });
    for (const row of r.rows) {
      expect(row['source']).toBe('public');
      expect(row['reviewed']).toBe('no');
      expect(row['tactics']).toBe('');
      expect(row['scam_type'] === 'none').toBe(row['is_scam'] === '0');
    }
    expect(r.rows.some((x) => x['hard_negative'] === '1')).toBe(true);
  });

  it('gives the same result every time with the same seed, and a sample for auditing', () => {
    const a = processOrigin('sentinel', fakeSource(), options);
    const b = processOrigin('sentinel', fakeSource(), options);
    expect(a.rows).toEqual(b.rows);
    expect(a.audit.length).toBeLessThanOrEqual(100);
    expect(a.audit[0]).toHaveProperty('my_verdict', '');
  });

  it('removes messages that appear with both labels, and exact duplicates', () => {
    const src: ParseResult = {
      records: [
        { text: 'Your refund will be credited in five days', label: 1 },
        { text: 'Your refund will be credited in five days', label: 0 },
        { text: 'This message appears twice in the source file', label: 0 },
        { text: 'This message appears twice in the source file', label: 0 },
      ],
      skipped: 0,
      notes: [],
    };
    const r = processOrigin('bolewara', src, DEFAULT_OPTIONS);
    expect(r.rows.map((x) => x['text'])).toEqual(['This message appears twice in the source file']);
  });

  it('drops text that is too short or too long, and warns when a source is English only', () => {
    const src: ParseResult = {
      records: [
        { text: 'ok see you', label: 0 },
        { text: 'x'.repeat(700), label: 0 },
        { text: 'A perfectly ordinary message of normal length', label: 0 },
      ],
      skipped: 0,
      notes: [],
    };
    const r = processOrigin('bolewara', src, DEFAULT_OPTIONS);
    expect(r.rows).toHaveLength(1);
    expect(r.report.join('\n')).toContain('English only');
  });
});

describe('runPipeline', () => {
  it('merges imported rows with your own and produces files that pass the checker', () => {
    const result = runPipeline({
      sentinel: fakeSource(),
      bolewara: { records: [{ text: 'Free entry in a weekly competition, text WIN to 80488 now', label: 1 }, { text: 'Are you coming to dinner at home tonight', label: 0 }], skipped: 0, notes: [] },
      own: [{ name: 'dataset_seed.csv', csv: OWN_CSV }],
      stamp: '2026-01-01',
    });
    expect(result.full.errors).toEqual([]);
    expect(validateDataset(result.full.csv).errors).toEqual([]);
    expect(result.full.csv).toContain('S01');
    expect(result.full.csv).toContain('sentinel-t');
  });

  it('keeps Shade63 rows out of the publishable file', () => {
    const result = runPipeline({
      sentinel: fakeSource(),
      bolewara: { records: [{ text: 'Free entry in a weekly competition, text WIN to 80488 now', label: 1 }, { text: 'Are you coming to dinner at home tonight', label: 0 }], skipped: 0, notes: [] },
      own: [{ name: 'dataset_seed.csv', csv: OWN_CSV }],
      stamp: '2026-01-01',
    });
    expect(result.publishable.errors).toEqual([]);
    expect(result.publishable.csv).not.toContain('sentinel-t');
    expect(result.publishable.csv).toContain('bolewara-t');
    expect(result.publishable.csv).toContain('S01');
  });
});