import Link from "next/link";
import { AppNavigation } from "../app-navigation";
import { InstallControl } from "../install-provider";

export default function InstallPage() {
  return <main className="shell install-page">
    <AppNavigation current="OPTIONS" />
    <header className="command-hero"><p className="command-kicker">Bunch on your phone</p><h1>Add Bunch to your home screen</h1><p>One icon to open your private companion. No app store needed.</p><InstallControl /></header>
    <section className="panel" aria-labelledby="iphone-install"><h2 id="iphone-install">iPhone · Safari</h2><ol>
      <li>Open this site in <strong>Safari</strong>. If you opened it inside another app, copy the address into Safari first.</li>
      <li>Tap <strong>Share</strong>. You may need to open Safari’s <strong>More</strong> menu first.</li>
      <li>Scroll to <strong>Add to Home Screen</strong>. Leave <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li>
    </ol><a className="install-help-link" href="https://support.apple.com/guide/iphone/iphea86e5236/ios">Apple’s illustrated instructions</a></section>
    <section className="panel" aria-labelledby="android-install"><h2 id="android-install">Android · Chrome</h2><ol>
      <li>Open this site in <strong>Chrome</strong>.</li>
      <li>Tap <strong>Install Bunch</strong> above if available, or open Chrome’s <strong>More</strong> menu (three dots).</li>
      <li>Choose <strong>Add to home screen</strong>, then <strong>Install</strong>. If Chrome offers <strong>Create shortcut</strong> instead, that also gives you a home-screen link.</li>
    </ol><a className="install-help-link" href="https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en">Google’s installation instructions</a></section>
    <section className="panel"><h2>Ready for your first launch</h2><p>Tap the <strong>Bunch</strong> icon on your home screen. Sign in with your usual Google account if asked, then check that Catch-up and People open.</p><p>Bunch needs an internet connection. Installation does not make your records public.</p><Link className="button" href="/home">Open Catch-up</Link></section>
  </main>;
}
