"use client";
// Screenshot-only page for /demo with FIXED SAMPLE DATA (?state=idle|asked|approving|moving|paid, &t=ms freezes the
// token mid-flight). It never calls the wallet, Firebase or an AI. It does not exist in production builds.
import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { bigAmount } from "@/lib/ui/amountview";
import { tokenText, type DemoStage } from "@/lib/ui/demoflow";
import { customerWalletLines, shopWalletLines } from "@/lib/ui/demowallet";
import { shopStatusView } from "@/lib/ui/requestprompt";
import { FingerprintIcon, PayCard, PayCodeView, ReceiptCard, RequestCard } from "../ui";
import { ShopStatus } from "../shop/ShopView";
import { DemoHalf, DemoShopForm, DemoStageView, DemoTopBar, DemoWallet, WaitingForRequest } from "../demo/DemoView";

const AMT = { value: "200000", assetCode: "NGN", assetScale: 2 };
const SHOP_WALLET = "https://ilp.interledger-test.dev/sample-shop";
const CUST_WALLET = "https://ilp.interledger-test.dev/sample-customer";
type S = "idle" | "asked" | "approving" | "moving" | "paid";

function Preview() {
  const q = useSearchParams();
  const raw = q.get("state");
  const state: S = raw === "asked" || raw === "approving" || raw === "moving" || raw === "paid" ? raw : "idle";
  const t = Number(q.get("t") ?? "900");
  const paid = state === "paid";
  const cap = { value: "5000", assetCode: "USD", assetScale: 2 };
  const sw = shopWalletLines(paid ? [{ ...AMT, count: 1 }] : [], SHOP_WALLET, false);
  const cw = customerWalletLines(paid ? [{ ...AMT, count: 1 }] : [], cap, CUST_WALLET, false);
  const stage: DemoStage = state === "idle" ? "idle" : state === "asked" ? "asked" : state === "approving" ? "approving" : state === "moving" ? "moving" : "done";
  const view = state === "idle" ? null : shopStatusView(paid ? "paid" : "pending", "31", AMT);

  const customer = (
    <DemoHalf side="customer" title="Customer (Ada, blind)" persona="Demo persona. Ada uses the app alone: she hears the request and approves it herself.">
      <DemoWallet title="Customer wallet" big={cw.big} lines={[cw.sent, cw.limit]} address={cw.address} fine="Totals from this account's receipts. Not a balance: Open Payments has none." />
      <PayCodeView code="472913" />
      {state === "idle" && <WaitingForRequest />}
      {state === "asked" && <RequestCard shopName="Mama Put" amount={bigAmount(AMT)} reference="31" note="Rice and stew" />}
      {state === "approving" && (
        <PayCard>
          <p className="amt">{bigAmount(AMT)}</p>
          <p className="to">to Mama Put</p>
          <div className="meta"><span>Reference 31</span><span>From the wallet&apos;s quote</span></div>
          <div className="stack">
            <button type="button" className="btn primary"><FingerprintIcon /> Approve with fingerprint</button>
            <button type="button" className="btn ghost">Use my PIN instead</button>
            <button type="button" className="btn quiet">Cancel</button>
          </div>
        </PayCard>
      )}
      {(state === "moving" || paid) && <ReceiptCard amount={bigAmount(AMT)} to="Mama Put" reference="31" how="Approved with fingerprint · saved by the server" simulated={false} />}
    </DemoHalf>
  );
  const shop = (
    <DemoHalf side="shop" title="Shop (Mama Put)" persona="The shop only asks. It cannot take money: the customer must approve.">
      <DemoWallet title="Shop wallet" big={sw.big} lines={[sw.received]} address={sw.address} fine="Counts the shop requests this server marked paid after a verified approval. Not a balance." bump={paid} />
      {view ? <ShopStatus tone={view.tone} headline={view.headline} sub={view.sub} shop="Mama Put" /> : <DemoShopForm shopName="Mama Put" code="47 29 13" amount="2000" note="" />}
    </DemoHalf>
  );
  return (
    <div className="dm">
      <DemoTopBar muted={false} />
      <DemoStageView stage={stage} token={tokenText(AMT)} screenReader="" customer={customer} shop={shop} freezeMs={Number.isFinite(t) ? t : 900} />
    </div>
  );
}

export default function DemoPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}
