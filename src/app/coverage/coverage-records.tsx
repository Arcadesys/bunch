"use client";

import { useState } from "react";
import type { AlterProfile, CoverageAssignment } from "@/domain/types";

export function DraftDetail({
  draft,
  profiles,
  onResolve,
}: {
  draft: CoverageAssignment;
  profiles: AlterProfile[];
  onResolve: (draftId: string, result: "CONFIRMED" | "REJECTED", alterId?: string) => void;
}) {
  const [alterId, setAlterId] = useState(draft.alterId || "");

  return (
    <>
      <label>
        Record this as
        <select value={alterId} onChange={(event) => setAlterId(event.target.value)}>
          <option value="">Choose before confirming</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <div className="detail-actions">
        <button
          className="button"
          type="button"
          disabled={!alterId}
          onClick={() => onResolve(draft.id, "CONFIRMED", alterId || undefined)}
        >
          Confirm coverage record
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => onResolve(draft.id, "REJECTED")}
        >
          Reject draft
        </button>
      </div>
    </>
  );
}

export function ConfirmedDetail({
  record,
  profiles,
}: {
  record: CoverageAssignment;
  profiles: AlterProfile[];
}) {
  const profile = profiles.find((p) => p.id === record.alterId);

  return (
    <div className="detail-facts">
      <div>
        <dt>Person</dt>
        <dd>{profile?.name || "Recorded alter"}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>Recorded as responsible for this period.</dd>
      </div>
    </div>
  );
}
