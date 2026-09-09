/** The importer pins this configured Bunch origin; never derive it from Host. */
export function configuredReferenceOrigin() {
  const configured = process.env.SYSTEM_PUBLIC_ORIGIN;
  if (!configured) throw new Error("SYSTEM_PUBLIC_ORIGIN is required for the reference API.");
  return new URL(configured).origin;
}
