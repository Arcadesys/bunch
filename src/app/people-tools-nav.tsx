import Link from "next/link";

type PeopleTool = "people" | "gallery" | "group-photo" | "images" | "profile-gallery" | "other-galleries";

export function PeopleToolsNav({ current }: { current: PeopleTool }) {
  const links = [
    ["people", "/profiles", "People"],
    ["profile-gallery", "/gallery", "My gallery"],
    ["other-galleries", "/gallery?view=others", "Other galleries"],
    ["gallery", "/gallery/generated", "Generated photos"],
    ["group-photo", "/group-photo", "Group Photo"],
    ["images", "/images", "Create Images"],
  ] as const;
  return <nav className="tool-tabs" aria-label="People and pictures">
    {links.map(([id, href, label]) => <Link key={id} href={href} aria-current={current === id ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
