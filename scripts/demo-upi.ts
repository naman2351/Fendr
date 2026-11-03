import { analyzePayment } from '../src/engine/upi.ts';

// All IDs are fake. Each line: [link, message the person received, shop name seen]
const samples: [string, string, string?][] = [
  ['upi://pay?pa=testshop@testbank&pn=Test%20Shop&am=4999&cu=INR', 'Refund of 4999 will be credited, scan to claim'],
  ['upi://pay?pa=testshop@testbank&pn=Test%20Shop&am=20', 'Pay for the tea'],
  ['upi://pay?pa=testshop@testbank&pn=Test%20Shop', ''],
  ['upi://pay?pa=ravi.kumar@testbank&pn=Ravi%20Kumar&am=250', 'SBI KYC update fee, pay now'],
  ['upi://pay?pa=refund.desk@testbank&pn=Help%20Desk&am=10', ''],
  ['upi://pay?pa=sbi.support@testbank&pn=SBI%20Support&am=1', ''],
  ['upi://pay?pn=NoAddress&am=10', ''],
  ['upi://pay?pa=testshop@testbank&am=99999999', ''],
  ['upi://pay?pa=testshop@testbank&pn=Test&am=500', 'Paise aapke account mein aa jayenge, QR scan karo'],
  ['upi://pay?pa=ravi.kumar@testbank&pn=Ravi%20Kumar&am=30', '', 'Sharma Tea Stall'],
];

for (const [link, message, shopName] of samples) {
  const a = analyzePayment(link, { message, shopName });
  console.log('LINK   :', link);
  if (message) console.log('STORY  :', message);
  if (shopName) console.log('SHOP   :', shopName);
  console.log('SAYS   :', a.explanation);
  console.log('RISK   :', a.signal.risk, '| REASONS:', a.signal.reasons.join(', ') || 'none');
  console.log('');
}