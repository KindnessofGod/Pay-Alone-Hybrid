"use client";
// Dev-only screenshot page: fixed SAMPLE screens built from the app's own components, so /demo?mock=1 shows
// realistic frames when Firebase is not available headlessly. Does not exist in production builds. No data, no network.
import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { Bubble, Chip, Dock, Header, PayCard, ReceiptCard } from "../ui";
import { ShopForm, ShopShell, ShopStatus } from "../shop/ShopView";
import { shopStatusView } from "@/lib/ui/requestprompt";

const AMT = { value: "200000", assetCode: "NGN", assetScale: 2 };

function Mock() {
  const q = useSearchParams();
  const side = q.get("side");
  const state = q.get("state") ?? "idle";
  if (side === "shop") {
    const view = state === "paid" ? shopStatusView("paid", "PA-4821", AMT) : state === "request" || state === "approving" ? shopStatusView("pending", "PA-4821", AMT) : null;
    return (
      <ShopShell>
        {view ? <ShopStatus tone={view.tone} headline={view.headline} sub={view.sub} shop="Mama Put" /> : <ShopForm shopName="Mama Put" code="47 29 13" amount="2000" note="" hideNote />}
      </ShopShell>
    );
  }
  return (
    <div className="app">
      <Header nano="available" />
      <div className="panel-body">
        <ol className="chat" aria-label="Conversation">
          <Bubble who="app" chip={<Chip source="rules" />}>Hello. What would you like to do today?</Bubble>
          {state !== "idle" && <Bubble who="app" chip={<Chip source="rules" />}>Mama Put asks you to pay ₦2,000. Check the card, then approve.</Bubble>}
        </ol>
        {(state === "request" || state === "approving") && (
          <PayCard>
            <p className="amt">₦2,000.00</p>
            <p className="to">to Mama Put</p>
            <div className="meta"><span>Reference <b className="ref">PA-4821</b></span></div>
            <div className="stack"><button type="button" className="btn primary">Approve with fingerprint</button><button type="button" className="btn quiet">Decline</button></div>
          </PayCard>
        )}
        {state === "paid" && <ReceiptCard amount="₦2,000.00" to="Mama Put" reference="PA-4821" simulated />}
      </div>
      <Dock hint="Tap and speak" listening={false} micLabel="Press to speak" typed="" tab="talk" />
    </div>
  );
}

export default function DemoMock() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Mock />
    </Suspense>
  );
}
