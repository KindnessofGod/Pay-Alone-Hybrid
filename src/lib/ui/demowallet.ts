// Words for the two wallet cards on /demo. Built from the server's own records. There is NO balance anywhere:
// Open Payments has no balance endpoint, so we show only what this page's records add up to.
import { bigAmount } from "./amountview";
import type { Amount } from "../money";

export interface Sum {
  assetCode: string;
  assetScale: number;
  value: string;
  count: number;
}

const list = (sums: Sum[]): string => sums.map((s) => bigAmount(s)).join(" + ");
const plural = (n: number) => `${n} payment${n === 1 ? "" : "s"}`;

export function shopWalletLines(received: Sum[], wallet: string | null, simulated: boolean): { big: string; received: string; address: string } {
  const n = received.reduce((a, s) => a + s.count, 0);
  return {
    big: received.length ? `${list(received)} received` : "Nothing received yet",
    received: `Received on this page: ${received.length ? list(received) : "nothing yet"} (${plural(n)})`,
    address: wallet && !simulated ? `Test shop wallet: ${wallet}` : "Simulated shop wallet: no real wallet in this run, no real money moves",
  };
}

export function customerWalletLines(sent: Sum[], cap: Amount, wallet: string | null, simulated: boolean): { big: string; sent: string; limit: string; address: string } {
  const capText = bigAmount(cap);
  const same = sent.length === 1 && sent[0].assetCode === cap.assetCode && sent[0].assetScale === cap.assetScale;
  const sentText = sent.length ? list(sent) : "nothing yet";
  return {
    big: sent.length ? `${sentText} sent this week` : "Nothing sent yet",
    sent: same ? `Sent this week: ${sentText} of ${capText} limit` : `Sent this week: ${sentText}`,
    limit: `Weekly limit on the wallet: ${capText}`,
    address: wallet && !simulated ? `Test customer wallet: ${wallet}` : "Simulated customer wallet: no real wallet in this run, no real money moves",
  };
}
