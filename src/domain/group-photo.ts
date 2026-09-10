import { z } from "zod";
import { uuidSchema } from "@/domain/contracts";

export const groupPhotoProjectStatusSchema = z.enum(["ANALYZING", "READY", "BLOCKING", "RENDERING", "COMPLETE", "FAILED"]);
export const occupancyZoneSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(["sit", "stand", "lean", "crouch"]),
  label: z.string().min(1).max(160),
  bounds: z.object({ x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(100), width: z.number().int().min(1).max(100), height: z.number().int().min(1).max(100) }),
  capacity: z.number().int().min(1).max(20),
  depth: z.number().int().min(0).max(100),
});

export const sceneAnalysisSchema = z.object({
  source: z.enum(["PROVISIONAL", "VISION_MODEL"]),
  camera: z.object({ height: z.enum(["low", "eye-level", "high"]), angle: z.enum(["level", "slightly-down", "slightly-up"]) }),
  lighting: z.object({ direction: z.enum(["unknown", "left", "right", "front", "back"]), colorTemperature: z.enum(["unknown", "warm", "neutral", "cool"]) }),
  occupancyZones: z.array(occupancyZoneSchema).min(1).max(20),
  recommendations: z.array(z.string().min(1).max(300)).max(10),
});
export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;

export const groupPhotoPlacementInputSchema = z.object({
  alterId: uuidSchema,
  tokenX: z.number().int().min(0).max(100),
  tokenY: z.number().int().min(0).max(100),
  depth: z.number().int().min(0).max(100).default(50),
  occupancyZoneId: z.string().min(1).max(120).nullable().optional(),
  relationHints: z.array(z.enum(["close-together", "next-to", "behind", "in-front-of", "center", "edge", "group"])).max(7).default([]),
});
export type GroupPhotoPlacementInput = z.infer<typeof groupPhotoPlacementInputSchema>;

export type GroupPhotoPlacement = GroupPhotoPlacementInput & { id: string; version: number; createdAt: string; updatedAt: string };
export type GroupPhotoProject = { id: string; backplateContentType: string; sceneAnalysis: SceneAnalysis; status: z.infer<typeof groupPhotoProjectStatusSchema>; version: number; createdAt: string; updatedAt: string; placements: GroupPhotoPlacement[]; renders?: GroupPhotoRender[] };

// This is intentionally a conservative fallback, not a claim that a vision
// model understood the image. A later provider replaces this artifact in place.
export function provisionalSceneAnalysis(): SceneAnalysis {
  return {
    source: "PROVISIONAL",
    camera: { height: "eye-level", angle: "level" },
    lighting: { direction: "unknown", colorTemperature: "unknown" },
    occupancyZones: [
      { id: "front-row", type: "sit", label: "Front row", bounds: { x: 10, y: 62, width: 80, height: 27 }, capacity: 4, depth: 36 },
      { id: "back-row", type: "stand", label: "Back row", bounds: { x: 12, y: 24, width: 76, height: 38 }, capacity: 5, depth: 68 },
    ],
    recommendations: ["Start with the front row for seated or crouching people.", "Use the back row for standing or leaning people."],
  };
}

export function nearestOccupancyZone(analysis: SceneAnalysis, tokenX: number, tokenY: number) {
  return analysis.occupancyZones.reduce((best, zone) => {
    const centerX = zone.bounds.x + zone.bounds.width / 2;
    const centerY = zone.bounds.y + zone.bounds.height / 2;
    const distance = (centerX - tokenX) ** 2 + (centerY - tokenY) ** 2;
    return distance < best.distance ? { zone, distance } : best;
  }, { zone: analysis.occupancyZones[0], distance: Number.POSITIVE_INFINITY }).zone;
}

export const arrangeActionSchema = z.enum(["forward", "backward", "front", "back"]);
export type ArrangeAction = z.infer<typeof arrangeActionSchema>;

/** Larger depth is nearer the viewer, matching the stage's stacking order. */
export function arrangePlacements(placements: GroupPhotoPlacement[], alterId: string, action: ArrangeAction) {
  const ordered = [...placements].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  const index = ordered.findIndex(item => item.alterId === alterId);
  if (index < 0) throw new Error("Place that person before arranging them.");
  const target = action === "front" ? ordered.length - 1 : action === "back" ? 0 :
    Math.max(0, Math.min(ordered.length - 1, index + (action === "forward" ? 1 : -1)));
  const [selected] = ordered.splice(index, 1);
  ordered.splice(target, 0, selected);
  return ordered.map((item, rank) => ({ ...item, depth: Math.round((rank + 1) * 100 / (ordered.length + 1)) }));
}

export function compositionGuidance(placements: GroupPhotoPlacement[]) {
  return [
    "Compose one cohesive group photo in the supplied scene. Token positions express approximate composition and social grouping, not exact poses or pasted cutouts.",
    "Coordinates run left to right (x 0–100) and top to bottom (y 0–100). Keep nearby tokens together in that part of the scene: three tokens together on the left means those three people together on the left. Use natural poses, spacing, perspective, lighting and contact shadows. Do not spread a cluster across the scene.",
    "Larger depth means nearer the viewer. Respect this order when people overlap; keep each person recognizable. Do not draw tokens, labels or staging guides.",
    ...[...placements].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)).map(p =>
      `Person ${p.alterId}: x ${p.tokenX}%, y ${p.tokenY}%, layer depth ${p.depth}.`),
  ].join("\n");
}

export type GroupPhotoRender = {
  id: string; sourceVersion: number; state: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  createdAt: string; finishedAt: string | null; errorMessage: string | null;
  width: number | null; height: number | null; contentHash: string | null;
};
