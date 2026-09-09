import { getDemoSystem } from "@/server/demo-system";

// An explicitly public fictional snapshot. No identity or private store reads.
export async function GET() {
  return Response.json(getDemoSystem(), { headers: { "Cache-Control": "no-store" } });
}
