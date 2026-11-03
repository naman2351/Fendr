export type Signal = {
  detector: 'message' | 'payment' | 'link' | 'ocr';
  risk: number; // 0 to 1, how risky this detector thinks the input is
  confidence: number; // 0 to 1, how sure the detector is
  reasons: string[]; // keys that map to explanation templates
  evidence?: string[]; // text snippets or URLs shown to the user
};