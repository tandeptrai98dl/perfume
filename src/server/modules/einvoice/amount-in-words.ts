/**
 * Invoice total in Vietnamese words ("Một triệu hai trăm năm mươi nghìn đồng"), required on
 * Vietnamese invoices. The words come from `admin.einvoices.words` in messages/vi.json; this
 * file only holds the reading rules:
 * - each 3-digit group reads "<h> trăm <t> mươi <u>"; a group after a higher one always reads
 *   its hundreds ("không trăm") and "linh" before a lone unit;
 * - tens: 10–19 "mười", unit 5 after tens "lăm", 1 after tens ≥ 2 "mốt", 4 after tens ≥ 2 "tư";
 * - scales nghìn / triệu / tỷ, repeated for larger amounts ("nghìn tỷ").
 */

export type AmountWordsLexicon = {
  digits: readonly string[];
  hundred: string;
  ten: string;
  tens: string;
  odd: string;
  oneAfterTens: string;
  fourAfterTens: string;
  five: string;
  thousand: string;
  million: string;
  billion: string;
  currency: string;
};

function readGroup(n: number, full: boolean, w: AmountWordsLexicon): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (full || h > 0) out.push(w.digits[h]!, w.hundred);
  if (t === 0) {
    if (u > 0) {
      if (full || h > 0) out.push(w.odd);
      out.push(w.digits[u]!);
    }
  } else if (t === 1) {
    out.push(w.ten);
    if (u === 5) out.push(w.five);
    else if (u > 0) out.push(w.digits[u]!);
  } else {
    out.push(w.digits[t]!, w.tens);
    if (u === 1) out.push(w.oneAfterTens);
    else if (u === 4) out.push(w.fourAfterTens);
    else if (u === 5) out.push(w.five);
    else if (u > 0) out.push(w.digits[u]!);
  }
  return out;
}

/** Words for 0 < n < 1e9 (`full` = a higher group was already read). */
function readBelowBillion(n: number, full: boolean, w: AmountWordsLexicon): string[] {
  const groups = [Math.floor(n / 1_000_000), Math.floor((n % 1_000_000) / 1000), n % 1000];
  const scales = [w.million, w.thousand, ''];
  const out: string[] = [];
  let started = full;
  groups.forEach((group, i) => {
    if (group === 0) return;
    out.push(...readGroup(group, started, w));
    if (scales[i]) out.push(scales[i]!);
    started = true;
  });
  return out;
}

function read(n: number, full: boolean, w: AmountWordsLexicon): string[] {
  if (n < 1_000_000_000) return readBelowBillion(n, full, w);
  const billions = Math.floor(n / 1_000_000_000);
  const rest = n % 1_000_000_000;
  const out = [...read(billions, full, w), w.billion];
  if (rest > 0) out.push(...readBelowBillion(rest, true, w));
  return out;
}

export function amountInWords(amount: number, w: AmountWordsLexicon): string {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new RangeError('amount must be a whole VND amount');
  const words = amount === 0 ? [w.digits[0]!] : read(amount, false, w);
  const text = [...words, w.currency].join(' ');
  return text.charAt(0).toLocaleUpperCase('vi') + text.slice(1);
}
