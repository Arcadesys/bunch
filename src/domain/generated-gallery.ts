export type GeneratedPhoto = {
  id: string;
  kind: "scene" | "group";
  createdAt: string;
  description: string;
  width: number | null;
  height: number | null;
  imageUrl: string;
  sourceUrl: string;
};
export type GeneratedGalleryPage = { data: GeneratedPhoto[]; meta: { nextCursor: string | null } };
