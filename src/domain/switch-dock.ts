// Pure rules behind the Switch dock, kept apart from the component so the
// tap-to-record decisions and the recent-switch list are testable directly.
import type { FrontingHistoryResponse } from "./fronting-history";
import type { PresencePeriod } from "./presence";

export type SwitchMode = "HOST" | "ALSO";
export type CurrentPresence = { hosting: PresencePeriod | null; fronting: PresencePeriod[] };
export type SwitchIntent =
  | { action: "HOST" }
  | { action: "CLEAR" }
  | { action: "START" }
  | { action: "END"; episode: PresencePeriod };

export const SWITCH_TRIGGERS = ["Woke up", "Stress", "Conflict", "Overwhelm", "Tired", "No idea"] as const;

// Tapping someone who already carries the chosen role ends that role instead of
// writing a duplicate. Hosting taps never touch fronting episodes, and back.
export function tapIntent(mode: SwitchMode, alterId: string, presence: CurrentPresence): SwitchIntent {
  if (mode === "HOST") return presence.hosting?.alterId === alterId ? { action: "CLEAR" } : { action: "HOST" };
  const episode = presence.fronting.find(p => p.alterId === alterId);
  return episode ? { action: "END", episode } : { action: "START" };
}

// Only arrivals carry energy and trigger; an end has nothing to describe.
export const isArrival = (action: SwitchIntent["action"]) => action === "HOST" || action === "START";

export function initials(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

export function elapsed(at: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function loggedHeadline(action: SwitchIntent["action"], name: string, clock: string) {
  const verb = { HOST: " is hosting", START: " is here alongside", END: "’s episode ended", CLEAR: " stopped hosting" }[action];
  return `${name}${verb} · logged ${clock}`;
}

export type SwitchEventKind = "HOST" | "ALSO" | "END_HOST" | "END" | "LEGACY";
export type SwitchEvent = { key: string; alterName: string; kind: SwitchEventKind; at: string; detail: string };

const eventLines: Record<SwitchEventKind, string> = {
  HOST: "started hosting",
  ALSO: "came in alongside",
  END_HOST: "ended hosting",
  END: "ended a fronting episode",
  LEGACY: "has a legacy front record",
};
export const switchEventLine = (event: SwitchEvent) => `${event.alterName} ${eventLines[event.kind]}`;

// History returns periods; the dock lists the moments they began and ended.
// A handoff ends one hosting period at the instant the next begins, and the
// incoming host's line already says so, so that end is not listed twice.
export function recentSwitches(records: FrontingHistoryResponse["data"], limit = 5): SwitchEvent[] {
  const hostingStarts = new Set(records.filter(r => r.kind === "HOSTING").map(r => Date.parse(r.startedAt)));
  const events: SwitchEvent[] = [];
  for (const record of records) {
    const detail = [record.energy ? `energy ${record.energy}/5` : "", record.trigger?.toLowerCase() ?? ""].filter(Boolean).join(" · ");
    const kind = record.kind === "HOSTING" ? "HOST" : record.kind === "FRONTING" ? "ALSO" : "LEGACY";
    events.push({ key: `${record.kind}:${record.id}:start`, alterName: record.alterName, kind, at: record.startedAt, detail });
    if (!record.endedAt || record.kind === "LEGACY_FRONT") continue;
    if (record.kind === "HOSTING" && hostingStarts.has(Date.parse(record.endedAt))) continue;
    events.push({ key: `${record.kind}:${record.id}:end`, alterName: record.alterName, kind: record.kind === "HOSTING" ? "END_HOST" : "END", at: record.endedAt, detail: "" });
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
