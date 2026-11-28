// The big amount on the approval card, built from the quote's integer minor units. No floats.
import { formatAmount, isAmount, type Amount } from "../money";

const SYMBOL: Record<string, string> = { NGN: "₦", USD: "$" };

export const isAmountView = (a: unknown): a is Amount => isAmount(a);

/** "₦500.00", "$1.48", or "KES 10.00" when there is no short symbol. */
export function bigAmount(a: Amount): string {
  const plain = formatAmount(a).slice(a.assetCode.length + 1); // "NGN 2,050.00" -> "2,050.00"
  const sym = SYMBOL[a.assetCode];
  return sym ? `${sym}${plain}` : `${a.assetCode} ${plain}`;
}
