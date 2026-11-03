import { describe, it, expect } from 'vitest';
import {
  parseUpi,
  detectReceiveIntent,
  analyzePayment,
  explainPayment,
  namesMatch,
  MAX_INPUT_LENGTH,
} from '../src/engine/upi';

// All IDs below are fake test values.
const SHOP = 'upi://pay?pa=testshop@testbank&pn=Test%20Shop&am=100&cu=INR';

describe('parseUpi', () => {
  it('parses a normal pay link', () => {
    const p = parseUpi('upi://pay?pa=testshop@testbank&pn=Test%20Shop&am=4999&cu=INR&tn=Refund');
    expect(p.valid).toBe(true);
    expect(p.payeeAddress).toBe('testshop@testbank');
    expect(p.payeeName).toBe('Test Shop');
    expect(p.amount).toBe(4999);
    expect(p.note).toBe('Refund');
    expect(p.hasMerchantCode).toBe(false);
  });

  it('case 12: accepts capital letters in the scheme', () => {
    const p = parseUpi('UPI://PAY?pa=testshop@testbank&pn=Test');
    expect(p.valid).toBe(true);
    expect(p.action).toBe('pay');
  });

  it('case 13: ignores unknown extra parameters', () => {
    const p = parseUpi('upi://pay?pa=testshop@testbank&foo=bar&xyz=1');
    expect(p.valid).toBe(true);
  });

  it('case 7: missing payee address is invalid and does not crash', () => {
    const p = parseUpi('upi://pay?pn=Test&am=10');
    expect(p.valid).toBe(false);
    expect(p.errors).toContain('missing_payee');
  });

  it('case 8: malformed percent-encoding is handled gracefully', () => {
    const p = parseUpi('upi://pay?pa=testshop@testbank&pn=Bad%ZZName%E0%A4%A');
    expect(p.valid).toBe(true);
    expect(p.warnings).toContain('malformed_encoding');
    expect(p.payeeName).toContain('Bad');
  });

  it('case 9: zero, negative or non-numeric amounts are invalid', () => {
    for (const am of ['0', '-5', 'abc', '10.999', '1e5']) {
      const p = parseUpi(`upi://pay?pa=testshop@testbank&am=${am}`);
      expect(p.valid, `am=${am}`).toBe(false);
      expect(p.errors).toContain('bad_amount');
    }
  });

  it('case 10: a very large amount is allowed but warned about', () => {
    const p = parseUpi('upi://pay?pa=testshop@testbank&am=99999999');
    expect(p.valid).toBe(true);
    expect(p.warnings).toContain('unusual_amount');
  });

  it('rejects a badly formed UPI ID', () => {
    const p = parseUpi('upi://pay?pa=not-a-upi-id');
    expect(p.valid).toBe(false);
    expect(p.errors).toContain('bad_payee_format');
  });

  it('rejects non-UPI text and other actions', () => {
    expect(parseUpi('https://example.com').errors).toContain('not_upi');
    expect(parseUpi('upi://mandate?pa=a@b').errors).toContain('unsupported_action');
  });

  it('rejects huge input without crashing', () => {
    const p = parseUpi('upi://pay?pa=testshop@testbank&pn=' + 'A'.repeat(MAX_INPUT_LENGTH));
    expect(p.valid).toBe(false);
    expect(p.errors).toContain('too_long');
  });

  it('notes a merchant code when present', () => {
    const p = parseUpi('upi://pay?pa=testshop@testbank&mc=5411');
    expect(p.hasMerchantCode).toBe(true);
  });
});

describe('detectReceiveIntent', () => {
  it('finds English receive stories', () => {
    expect(detectReceiveIntent('Your refund of 500 will be credited').matched).toBe(true);
    expect(detectReceiveIntent('Congratulations winner! Claim your prize').matched).toBe(true);
  });

  it('case 11: finds Hinglish receive stories', () => {
    const r = detectReceiveIntent('Paise aapke account mein aa jayenge, QR scan karo');
    expect(r.matched).toBe(true);
    expect(r.phrases).toContain('account mein aa jayenge');
  });

  it('finds Hindi (Devanagari) receive stories', () => {
    expect(detectReceiveIntent('आपका रिफंड मिलेगा, QR स्कैन करें').matched).toBe(true);
  });

  it('does not fire on ordinary payment talk', () => {
    expect(detectReceiveIntent('Please pay for the tea').matched).toBe(false);
    expect(detectReceiveIntent('').matched).toBe(false);
  });

  it('does not fire in the middle of another word', () => {
    expect(detectReceiveIntent('He wrote a proclaim about it').matched).toBe(false);
  });
});

describe('namesMatch', () => {
  it('case 15: tolerates a small typo', () => {
    expect(namesMatch('Sharma Tea Stall', 'Sharma Tea Stal')).toBe(true);
  });
  it('case 14: flags clearly different names', () => {
    expect(namesMatch('Sharma Tea Stall', 'Ravi Kumar')).toBe(false);
  });
  it('ignores case and punctuation', () => {
    expect(namesMatch('SHARMA TEA-STALL', 'sharma tea stall')).toBe(true);
  });
});

describe('explainPayment', () => {
  it('says money leaves your account when an amount is set', () => {
    const text = explainPayment(parseUpi('upi://pay?pa=testshop@testbank&pn=Test%20Shop&am=4999'));
    expect(text).toContain('₹4,999');
    expect(text).toContain('from you');
    expect(text).toContain('will not send you money');
  });

  it('case 3: says you will enter the amount when there is none', () => {
    const text = explainPayment(parseUpi('upi://pay?pa=testshop@testbank&pn=Test%20Shop'));
    expect(text).toContain('enter the amount');
  });

  it('handles an invalid link politely', () => {
    expect(explainPayment(parseUpi('hello'))).toContain('not look like a valid UPI');
  });
});

describe('analyzePayment', () => {
  it('case 1: receive story plus pay link is a mismatch', () => {
    const a = analyzePayment(SHOP, {
      message: 'Refund of 100 will be credited, scan to claim',
    });
    expect(a.signal.detector).toBe('payment');
    expect(a.signal.reasons).toContain('receive_but_pays');
    expect(a.signal.reasons).toContain('prefilled_amount');
    expect(a.signal.risk).toBeGreaterThanOrEqual(0.95);
  });

  it('case 2: an ordinary payment stays low risk', () => {
    const a = analyzePayment(SHOP, { message: 'Pay for the tea' });
    expect(a.signal.reasons).not.toContain('receive_but_pays');
    expect(a.signal.risk).toBeLessThan(0.25);
    expect(a.explanation).toContain('from you');
  });

  it('a link with no story and no flags says no red flags, with low confidence', () => {
    const a = analyzePayment(SHOP);
    expect(a.signal.reasons).toEqual([]);
    expect(a.signal.risk).toBeLessThan(0.25);
    expect(a.signal.confidence).toBeLessThan(0.7);
  });

  it('case 4: a personal account used for a bank or KYC story is flagged', () => {
    const a = analyzePayment(
      'upi://pay?pa=ravi.kumar@testbank&pn=Ravi%20Kumar&am=250&cu=INR',
      { message: 'SBI KYC update fee, pay now' },
    );
    expect(a.signal.reasons).toContain('personal_for_business');
  });

  it('does not call it personal when a merchant code is present', () => {
    const a = analyzePayment(
      'upi://pay?pa=ravi.kumar@testbank&pn=Ravi%20Kumar&am=250&mc=5411',
      { message: 'SBI KYC update fee, pay now' },
    );
    expect(a.signal.reasons).not.toContain('personal_for_business');
  });

  it('does not call a business name personal', () => {
    const a = analyzePayment(
      'upi://pay?pa=sharma.tea@testbank&pn=Sharma%20Tea%20Stall&am=20',
      { message: 'Bank officer says pay now' },
    );
    expect(a.signal.reasons).not.toContain('personal_for_business');
  });

  it('case 5: a refund-desk style UPI ID is flagged', () => {
    const a = analyzePayment('upi://pay?pa=refund.desk@testbank&pn=Someone');
    expect(a.signal.reasons).toContain('lookalike_handle');
  });

  it('case 6: a brand plus support UPI ID is flagged more strongly', () => {
    const a = analyzePayment('upi://pay?pa=sbi.support@testbank&pn=Someone');
    expect(a.signal.reasons).toContain('lookalike_handle');
    expect(a.signal.risk).toBeGreaterThanOrEqual(0.6);
  });

  it('does not flag an ordinary UPI ID', () => {
    const a = analyzePayment('upi://pay?pa=ravi.kumar@testbank&pn=Ravi%20Kumar');
    expect(a.signal.reasons).not.toContain('lookalike_handle');
  });

  it('case 14: a different shop name raises a name mismatch', () => {
    const a = analyzePayment(
      'upi://pay?pa=ravi.kumar@testbank&pn=Ravi%20Kumar',
      { shopName: 'Sharma Tea Stall' },
    );
    expect(a.signal.reasons).toContain('name_mismatch');
  });

  it('case 15: a small typo in the shop name raises no mismatch', () => {
    const a = analyzePayment(
      'upi://pay?pa=sharma.tea@testbank&pn=Sharma%20Tea%20Stal',
      { shopName: 'Sharma Tea Stall' },
    );
    expect(a.signal.reasons).not.toContain('name_mismatch');
  });

  it('case 10: an unusual amount adds a mild flag', () => {
    const a = analyzePayment('upi://pay?pa=testshop@testbank&am=99999999');
    expect(a.signal.reasons).toContain('unusual_amount');
  });

  it('case 7: an invalid link gives a gentle signal and never throws', () => {
    const a = analyzePayment('upi://pay?pn=Test', { message: 'refund' });
    expect(a.signal.reasons).toEqual(['invalid_link']);
    expect(a.signal.risk).toBeLessThan(0.5);
  });

  it('keeps risk between 0 and 1', () => {
    const a = analyzePayment(
      'upi://pay?pa=sbi.refund@testbank&pn=Ravi%20Kumar&am=500',
      { message: 'SBI refund will be credited', shopName: 'Sharma Tea Stall' },
    );
    expect(a.signal.risk).toBeGreaterThanOrEqual(0);
    expect(a.signal.risk).toBeLessThanOrEqual(1);
  });
});