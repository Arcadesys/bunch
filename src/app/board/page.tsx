import { Board } from "./board";
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { view } = await searchParams;
  return <Board view={view === "board" ? "board" : "list"} />;
}
