import { materializeAuthorizedReferenceMedia, type AuthorizedReferenceMedia } from "./furry-transform-media";

// Assistant-side callers pass _meta.referenceMedia directly to this function,
// then invoke image_gen with the supplied local paths. The callback boundary
// guarantees private temporary references are removed after the edit attempt.
export async function withFurryTransformReferences<T>(referenceMedia: AuthorizedReferenceMedia[], publicOrigin: string, run: (referencePaths: string[]) => Promise<T>): Promise<T> {
  const materialized = await materializeAuthorizedReferenceMedia(referenceMedia, publicOrigin);
  try { return await run(materialized.paths); }
  finally { await materialized.cleanup(); }
}
