"use client";
// Screenshot-only page with FIXED SAMPLE DATA. It never calls the wallet, Firebase or an AI.
// It does not exist in production builds.
//   /design-preview?view=idle|listening|chat|request|approve|pin|paid|setup|settings|history|unconnected&tab=home|talk   one full screen
//   /design-preview?view=start                                                                                            the start layer
//   /design-preview?view=shop&state=form|error|waiting|paid|declined|expired                                             the shop page
//   /design-preview                                                                                                       an index of pieces
import { Suspense } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { LanguagePicker, SetupView, StartLayer, PayCodeView, PrivacyCard } from "../ui";
import { ShopForm, ShopShell, ShopStatus } from "../shop/ShopView";
import { shopStatusView } from "@/lib/ui/requestprompt";
import { PreviewDash, type PreviewHybrid, type PreviewState } from "./PreviewDash";

const SAMPLE = { value: "200000", assetCode: "NGN", assetScale: 2 };
const VIEWS: PreviewState[] = ["idle", "listening", "chat", "request", "approve", "pin", "paid", "setup", "settings", "history", "unconnected"];

function Shop({ state }: { state: string }) {
  const view = state === "waiting" ? shopStatusView("pending", "31", SAMPLE) : state === "paid" ? shopStatusView("paid", "31", SAMPLE) : state === "declined" ? shopStatusView("declined", "31", SAMPLE) : state === "expired" ? shopStatusView("expired", "31", SAMPLE) : null;
  return (
    <>
      <div className="banner" role="note">Design preview, sample data</div>
      <ShopShell>
        {view ? (
          <ShopStatus {...view} shop="Mama Put" />
        ) : (
          <ShopForm shopName="Mama Put" code="472913" amount="2,000" note="Rice and stew" recents={["472913", "118204"]} error={state === "error" ? "No customer has that pay code. Check the digits." : undefined} />
        )}
      </ShopShell>
    </>
  );
}

function Preview() {
  const q = useSearchParams();
  const view = q.get("view");
  if (view === "start") return <StartLayer inline lang="en" />;
  if (view === "shop") return <Shop state={q.get("state") ?? "form"} />;
  if (view && (VIEWS as string[]).includes(view)) return <PreviewDash state={view as PreviewState} tab={q.get("tab") === "talk" ? "talk" : "home"} hy={["agree", "checking", "offline", "rules"].includes(q.get("hy") ?? "") ? (q.get("hy") as PreviewHybrid) : undefined} />;
  return (
    <>
      <div className="banner" role="note">Design preview, sample data</div>
      <p className="preview-h">Full screens: add ?view=… to this address</p>
      <ul style={{ maxWidth: 640, margin: "0 auto 24px", padding: "0 16px", lineHeight: 1.9 }}>
        {[...VIEWS, "start", "shop"].map((v) => (
          <li key={v}><a href={`?view=${v}`}>{v}</a></li>
        ))}
      </ul>
      <p className="preview-h">First-run setup steps</p>
      <section aria-label="Setup steps" style={{ maxWidth: 480, margin: "0 auto 40px", display: "flex", flexDirection: "column", gap: 16, padding: "0 16px" }}>
        <SetupView step="pin" pin="48" count="2 digits" message="Before your first payment, let's set up. Type a 4 digit PIN you will remember, then press Enter." />
        <SetupView step="confirm" pin="" count="" message="Type it again to confirm." />
        <SetupView step="passkey" pin="" count="" message="Now let's add your fingerprint or Windows Hello, so you can approve without typing." />
        <SetupView step="done" pin="" count="" message="You're set. Your weekly limit is set on your wallet's own page when you connect it." />
      </section>
      <p className="preview-h">Language picker, pay code, privacy</p>
      <section style={{ maxWidth: 480, margin: "0 auto 40px", display: "flex", flexDirection: "column", gap: 16, padding: "0 16px" }}>
        <LanguagePicker id="lang-prev" value="fr" />
        <PayCodeView code="472913" onSay={() => undefined} />
        <PrivacyCard facts={[{ label: "Gemini Nano", value: "available" }, { label: "Voice", value: "natural" }]} />
      </section>
    </>
  );
}

export default function DesignPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
