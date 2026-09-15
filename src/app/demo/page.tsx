import { getDemoSystem } from "@/server/demo-system";
import { InteractiveDemo } from "./interactive-demo";

export const metadata = { title: "Try Demo system — Bunch" };

export default function DemoPage() {
  return <InteractiveDemo sample={getDemoSystem()} />;
}
