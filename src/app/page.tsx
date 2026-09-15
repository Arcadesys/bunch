import { redirect } from "next/navigation";
import { fictionalDemoEnabled } from "@/server/fictional-demo";
import { CatchUpCommandCenter } from "./catch-up-command-center";

export default function SystemPage() {
  if (fictionalDemoEnabled()) redirect("/demo");
  return <CatchUpCommandCenter />;
}
