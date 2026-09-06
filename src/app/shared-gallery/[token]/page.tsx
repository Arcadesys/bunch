import type { Metadata } from "next";
import { SharedGallery } from "./shared-gallery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared photo gallery — DIDdy",
  description: "A read-only photo gallery shared by its owner.",
  robots: { index: false, follow: false },
};

export default async function SharedGalleryPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedGallery token={token} />;
}
