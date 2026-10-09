import { requireSameOrigin } from "@/server/http-api";
import { NextResponse } from "next/server";
import { suggestCoverage } from "@/domain/coverage";
import { requireOwnerId } from "@/server/auth";
import { repository } from "@/server/repository";
import { draftSchema, profileSchema, resolveDraftSchema } from "@/server/schemas";
import { getSystemService } from "@/server/system-service";
import { normalizeSystemError, SystemError, systemErrorStatus } from "@/server/system-error";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  const normalized = normalizeSystemError(error);
  if (normalized instanceof SystemError) {
    return NextResponse.json(
      { error: normalized.userMessage },
      { status: systemErrorStatus(normalized), headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  try {
    const ownerId = await requireOwnerId(request);
    const [currentFront, profiles, assignments] = await Promise.all([getSystemService().getCurrentFront(ownerId), repository.listProfiles(ownerId), repository.listAssignments(ownerId)]);
    return NextResponse.json({ currentFront, profiles, assignments }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const ownerId = await requireOwnerId(request);
    const body = await request.json();
    if (body.action === "saveProfile") {
      const input = profileSchema.parse(body.profile);
      const profile = await repository.saveProfile(ownerId, {
        name: input.name,
        selfDescribedGender: input.selfDescribedGender,
        description: input.description,
      }, body.profileId);
      return NextResponse.json({ profile });
    }
    if (body.action === "createDraft") {
      const input = draftSchema.parse(body.draft);
      const confirmed = await repository.confirmedDuring(ownerId, "0001-01-01", "9999-12-31");
      const suggestion = suggestCoverage(input, confirmed);
      const draft = await repository.createDraft(ownerId, {
        alterId: suggestion.alterId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        reasons: suggestion.reasons,
      });
      return NextResponse.json({ draft });
    }
    if (body.action === "resolveDraft") {
      const input = resolveDraftSchema.parse(body.resolution);
      const draft = await repository.resolveDraft(ownerId, input.draftId, input.result, input.alterId);
      return NextResponse.json({ draft });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
