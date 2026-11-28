import type { Metadata } from "next";
import { Suspense } from "react";
import DemoView from "./DemoView";

export const metadata: Metadata = { title: "Pay Alone demo", description: "The customer app and the shop app, side by side. Test money only." };

export default function DemoPage() {
  return (
    <Suspense fallback={null}>
      <DemoView />
    </Suspense>
  );
}
