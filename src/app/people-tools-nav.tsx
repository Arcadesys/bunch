import Link from "next/link";

type PeopleTool = "people" | "gallery" | "group-photo" | "images" | "profile-gallery";

export function PeopleToolsNav({ current }: { current: PeopleTool }) {
  const links = [
    ["people", "/profiles", "People"],
    ["gallery", "/gallery/generated", "Gallery"],
    ["profile-gallery", "/gallery", "Profile photos"],
    ["group-photo", "/group-photo", "Group Photo"],
    ["images", "/images", "Create Images"],
  ] as const;
  return <nav className="tool-tabs" aria-label="People and pictures">
    {links.map(([id, href, label]) => <Link key={id} href={href} aria-current={current === id ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
