import { analyzeLink } from '../src/engine/link.ts';

const links = [
  'https://www.sbi.co.in/',
  'https://onlinesbi.sbi/login',
  'https://example.com/',
  'http://sbi-kyc-update.xyz/login',
  'https://sbi.co.in.secure-login.xyz/',
  'https://paytrn.com/',
  'https://secure.paytm.com@evil.example.xyz/pay',
  'http://2130706433/',
  'https://bit.ly/3abcXYZ',
  'https://hdfcbank-login.top/verify',
  'javascript:alert(1)',
  'not a link',
];

for (const link of links) {
  const a = analyzeLink(link);
  console.log('LINK    :', link);
  console.log('RISK    :', a.signal.risk, '| CONFIDENCE:', a.signal.confidence);
  console.log('REASONS :', a.signal.reasons.join(', ') || 'none (no red flags found)');
  if (a.imitatedBrand) console.log('IMITATES:', a.imitatedBrand);
  if (a.officialBrand) console.log('OFFICIAL:', a.officialBrand);
  console.log('');
}