import type { AlterProfile, CoverageAssignment, ConfirmedCoverage } from "@/domain/types";

export type SuggestionInput = {
  startsOn: string;
  endsOn?: string;
  manualAlterId?: string;
  sharedContext?: string;
};

export type CoverageSuggestion = {
  alterId?: string;
  reasons: string[];
};

const dayKey = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function suggestCoverage(input: SuggestionInput, confirmed: ConfirmedCoverage[]): CoverageSuggestion {
  const reasons: string[] = [];
  let alterId = input.manualAlterId;

  if (alterId) reasons.push("You selected this alter in the optional check-in.");

  if (!alterId) {
    const matchingDay = [...confirmed].reverse().find((item) => dayKey(item.startsOn) === dayKey(input.startsOn));
    if (matchingDay) {
      alterId = matchingDay.alterId;
      reasons.push("This matches a prior confirmed coverage pattern on the same weekday.");
    }
  }

  if (input.sharedContext?.trim()) {
    reasons.push("You explicitly shared a short ChatGPT context note for this suggestion.");
  }

  if (!alterId) reasons.push("No alter is assumed. Choose one before confirming this draft.");
  return { alterId, reasons };
}

export function isOverlap(assignment: CoverageAssignment, startsOn: string, endsOn?: string): boolean {
  if (assignment.status !== "CONFIRMED") return false;
  const assignmentEnd = assignment.endsOn ?? "9999-12-31";
  const requestedEnd = endsOn ?? "9999-12-31";
  return assignment.startsOn <= requestedEnd && startsOn <= assignmentEnd;
}

export function toConfirmedCoverage(
  assignment: CoverageAssignment,
  alters: AlterProfile[],
): ConfirmedCoverage | undefined {
  if (assignment.status !== "CONFIRMED") return undefined;
  const alter = assignment.alterId && alters.find((candidate) => candidate.id === assignment.alterId);
  if (!alter) return undefined;
  return { id: assignment.id, alterId: assignment.alterId!, alterName: alter.name, startsOn: assignment.startsOn, endsOn: assignment.endsOn };
}
