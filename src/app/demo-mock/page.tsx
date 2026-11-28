"use client";
// Dev-only screenshot page: fixed SAMPLE screens built from the app's own components, so /demo?mock=1 shows
// realistic frames when Firebase is not available headlessly. Does not exist in production builds. No data, no network.
import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { ShopForm, ShopShell, ShopStatus } from "../shop/ShopView";
import { PreviewDash, type PreviewState } from "../design-preview/PreviewDash";
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
        {view ? <ShopStatus tone={view.tone} headline={view.headline} sub={view.sub} shop="Mama Put" /> : <ShopForm shopName="Mama Put" code="472913" amount="2000" note="" hideNote recents={["472913"]} />}
      </ShopShell>
    );
  }
  const s: PreviewState = state === "approving" ? "approve" : state === "request" ? "request" : state === "paid" ? "paid" : "idle";
  return <PreviewDash state={s} tab={q.get("tab") === "talk" ? "talk" : "home"} hy={state === "approving" ? "agree" : undefined} />;
}

export default function DemoMock() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Mock />
    </Suspense>
  );
}
