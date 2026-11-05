/**
 * Brands that scams commonly imitate, with their official web domains.
 *
 * STARTER LIST: VERIFY EVERY OFFICIAL DOMAIN on the brand's own website
 * before you ship. A wrong entry causes false alarms or false comfort.
 *
 * - tokens: lowercase words that identify the brand inside a domain name.
 *   Avoid ordinary words (a token like 'axis' would hit many innocent sites).
 * - officialDomains: registrable domains only (no www, no subdomains).
 *   Add a brand's sister sites here (for example its payments or video
 *   service), otherwise they get a mild false alarm.
 */
export type Brand = {
  name: string;
  tokens: string[];
  officialDomains: string[];
};

export const BRANDS: Brand[] = [
  { name: 'State Bank of India', tokens: ['sbi', 'onlinesbi', 'statebankofindia'], officialDomains: ['sbi.co.in', 'onlinesbi.sbi', 'sbicard.com'] },
  { name: 'HDFC Bank', tokens: ['hdfc', 'hdfcbank'], officialDomains: ['hdfcbank.com', 'hdfc.com', 'hdfclife.com', 'hdfcsec.com', 'hdfcergo.com'] },
  { name: 'ICICI Bank', tokens: ['icici', 'icicibank'], officialDomains: ['icicibank.com', 'icicidirect.com', 'iciciprulife.com', 'icicilombard.com'] },
  { name: 'Axis Bank', tokens: ['axisbank'], officialDomains: ['axisbank.com'] },
  { name: 'Kotak Mahindra Bank', tokens: ['kotak'], officialDomains: ['kotak.com'] },
  { name: 'Punjab National Bank', tokens: ['pnb', 'pnbindia'], officialDomains: ['pnbindia.in', 'netpnb.com'] },
  { name: 'Bank of Baroda', tokens: ['bankofbaroda'], officialDomains: ['bankofbaroda.in', 'bankofbaroda.com'] },
  { name: 'Paytm', tokens: ['paytm'], officialDomains: ['paytm.com', 'paytmbank.com', 'paytmmall.com'] },
  { name: 'PhonePe', tokens: ['phonepe'], officialDomains: ['phonepe.com'] },
  { name: 'Amazon', tokens: ['amazon'], officialDomains: ['amazon.in', 'amazon.com', 'amazonpay.in'] },
  { name: 'Flipkart', tokens: ['flipkart'], officialDomains: ['flipkart.com'] },
  { name: 'Swiggy', tokens: ['swiggy'], officialDomains: ['swiggy.com'] },
  { name: 'Zomato', tokens: ['zomato'], officialDomains: ['zomato.com'] },
  { name: 'WhatsApp', tokens: ['whatsapp'], officialDomains: ['whatsapp.com'] },
  { name: 'IRCTC', tokens: ['irctc'], officialDomains: ['irctc.co.in', 'irctc.com'] },
  { name: 'NPCI', tokens: ['npci'], officialDomains: ['npci.org.in'] },
  { name: 'Reserve Bank of India', tokens: ['rbi'], officialDomains: ['rbi.org.in'] },
  { name: 'UIDAI (Aadhaar)', tokens: ['uidai', 'aadhaar', 'aadhar'], officialDomains: ['uidai.gov.in'] },
  { name: 'Income Tax Department', tokens: ['incometax', 'incometaxindia'], officialDomains: ['incometax.gov.in', 'incometaxindia.gov.in'] },
  { name: 'EPFO', tokens: ['epfo', 'epfindia'], officialDomains: ['epfindia.gov.in'] },
  { name: 'Parivahan (RTO e-challan)', tokens: ['parivahan', 'echallan'], officialDomains: ['parivahan.gov.in'] },
  { name: 'DigiLocker', tokens: ['digilocker'], officialDomains: ['digilocker.gov.in'] },
  { name: 'India Post', tokens: ['indiapost'], officialDomains: ['indiapost.gov.in'] },
  { name: 'Jio', tokens: ['jio'], officialDomains: ['jio.com'] },
  { name: 'Airtel', tokens: ['airtel'], officialDomains: ['airtel.in', 'airtelxstream.in'] },
  { name: 'Canara Bank', tokens: ['canarabank'], officialDomains: ['canarabank.com', 'canarabank.in', 'canarabank.bank.in'] },
  { name: 'Union Bank of India', tokens: ['unionbank', 'unionbankofindia'], officialDomains: ['unionbankofindia.co.in', 'unionbankofindia.in'] },
  { name: 'Bank of India', tokens: ['bankofindia', 'boi'], officialDomains: ['bankofindia.co.in', 'bankofindia.bank.in'] },
  { name: 'Indian Bank', tokens: ['indianbank'], officialDomains: ['indianbank.in', 'indianbank.net.in'] },
  { name: 'IDBI Bank', tokens: ['idbi'], officialDomains: ['idbibank.in', 'idbi.bank.in'] },
  { name: 'IndusInd Bank', tokens: ['indusind'], officialDomains: ['indusind.com'] },
  { name: 'Yes Bank', tokens: ['yesbank'], officialDomains: ['yesbank.in'] },
  { name: 'Federal Bank', tokens: ['federalbank'], officialDomains: ['federalbank.co.in'] },
  { name: 'Bandhan Bank', tokens: ['bandhanbank'], officialDomains: ['bandhanbank.com'] },
  { name: 'IDFC First Bank', tokens: ['idfcfirstbank', 'idfc'], officialDomains: ['idfcfirstbank.com'] },
  { name: 'RBL Bank', tokens: ['rblbank'], officialDomains: ['rblbank.com'] },
  { name: 'Google Pay India', tokens: ['gpay', 'googlepay'], officialDomains: ['pay.google.com', 'google.com'] },
  { name: 'Mobikwik', tokens: ['mobikwik'], officialDomains: ['mobikwik.com'] },
  { name: 'Cred', tokens: ['cred'], officialDomains: ['cred.club'] },
  { name: 'Zeta', tokens: ['zeta'], officialDomains: ['zeta.tech'] },
  { name: 'Razorpay', tokens: ['razorpay'], officialDomains: ['razorpay.com'] },
  { name: 'Cashfree', tokens: ['cashfree'], officialDomains: ['cashfree.com'] },
  { name: 'Blinkit', tokens: ['blinkit', 'grofers'], officialDomains: ['blinkit.com'] },
  { name: 'Zepto', tokens: ['zepto'], officialDomains: ['zeptonow.com'] },
  { name: 'BigBasket', tokens: ['bigbasket'], officialDomains: ['bigbasket.com'] },
  { name: 'MakeMyTrip', tokens: ['makemytrip', 'mmt'], officialDomains: ['makemytrip.com'] },
  { name: 'BookMyShow', tokens: ['bookmyshow'], officialDomains: ['bookmyshow.com'] },
  { name: 'Ola', tokens: ['ola', 'olacabs'], officialDomains: ['olacabs.com', 'olaelectric.com'] },
  { name: 'Uber India', tokens: ['uber'], officialDomains: ['uber.com'] },
  { name: 'Ministry of Corporate Affairs', tokens: ['mca'], officialDomains: ['mca.gov.in'] },
  { name: 'Goods and Services Tax Network', tokens: ['gst', 'gstn'], officialDomains: ['gst.gov.in'] },
  { name: 'Passport Seva', tokens: ['passportindia'], officialDomains: ['passportindia.gov.in'] },
  { name: 'National Portal of India', tokens: ['india', 'mygov'], officialDomains: ['india.gov.in', 'mygov.in'] },
  { name: 'Election Commission of India', tokens: ['eci', 'voters'], officialDomains: ['eci.gov.in', 'voters.eci.gov.in'] },
  { name: 'TRAI', tokens: ['trai'], officialDomains: ['trai.gov.in'] }  
];