import { AppNavigation } from "../app-navigation";
import { PilotAccount } from "./pilot-account";

export default function AccountPage() {
  return <main className="app-page">
    <AppNavigation current="ACCOUNT" />
    <PilotAccount sections />
  </main>;
}
