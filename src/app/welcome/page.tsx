import type { Metadata } from "next";
import { BunchLanding } from "../bunch-landing";

export const metadata: Metadata = {
  title: "Bunch — a little more continuity",
  description:
    "A personal companion for life with DID. Keep your people, notes, pictures, and loose ends in one place.",
};

export default function WelcomePage() {
  return <BunchLanding />;
}
