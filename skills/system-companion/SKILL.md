---
name: system-companion
description: Use the private System MCP companion for explicit current-front switches, catch-up, notes, todos, decisions, important threads, and private media.
---

# System Companion

Use the authenticated System MCP tools as the source of truth. Preserve alter names exactly and use stable IDs returned by the tools.

## Hosting, fronting episodes, and legacy catch-up

- For “who was out when” or historical fronting questions, call list_fronting_history. Resolve a named profile with list_alters; use explicit-offset from/to instants for the requested local date range and follow nextCursor as before. Report kind and origin: HOSTING, FRONTING, or unclassified LEGACY_FRONT. A missing end means no end was recorded, and gaps do not prove absence.
- Never infer who is fronting from writing style, topic, mood, or prior history.
- Hosting means responsibility for everything otherwise unclaimed throughout the period out. Fronting episodes may overlap a host and each other and end independently. Hours versus days are examples, never expiry rules.
- Use get_current_presence to read both kinds. Only an explicit report of fronting authorizes start_fronting_episode; only an explicit end authorizes end_fronting_episode with the episode ID and version. Use set_system_host for explicit hosting changes.
- Do not classify legacy front records as hosting or an overlapping episode without user confirmation.
- Call `get_current_front`, resolve the target with `list_alters`, then call `switch_current_front` only for an explicitly requested legacy exclusive switch. New episodes use start_fronting_episode.
- For saved-record catch-up, default to the most recently arrived current fronter; offer other current fronting episodes. Hosting is independent. Pass that ID to get_catch_up or render_system_companion. These windows do not prove absence.
- After a successful explicit arrival, automatically prepare the conversation catch-up handoff and draft a brief only from sources actually available to this host. Show the draft, sources, and coverage gaps before any write; save only after the user explicitly authorizes it. Also offer `render_system_companion` for saved records. Do not interrupt an unrelated active chat.
- When the user asks to see the lineup, all alters, avatars, or profile pictures, call `render_alter_lineup`. Do not substitute image counts or filenames for rendered profile pictures.
- Catch-up is recipient-scoped but owner-visible. It includes direct notes, assigned or System-wide todos, decisions, confirmed important threads, and urgent carryover.
- `set_catch_up_item_state` changes only New, Acknowledged, Deferred, or Resolved review state. It never closes or edits the underlying record.
- A deferred item must return later today, tomorrow, at the next recorded period, or at a custom time.

## Notes, todos, and decisions

- Create a note or todo only when the user explicitly asks. Preserve approved wording.
- Use `alterId` for the note recipient or subject. Use `actorAlterId` only when the user explicitly names the author.
- Use `create_system_decision` when the user approves a first-class decision, next action, author if named, and recipients.
- Generate a fresh UUID for every `requestId`. Reuse it only when retrying the same mutation.

## Important threads

- At an explicit decision or action moment, the assistant may offer “Save this thread?” without interrupting the current work.
- Do not write until the user accepts.
- First call `suggest_important_thread` with the link, approved summary, key decision or action, who flagged it, and recipients. Never store a transcript.
- Call `confirm_important_thread` only after the user confirms those fields. Suggested threads do not enter catch-up.

## Private photos

- Use `open_private_photo_gallery` or the website's Profiles & Media surface for viewing photos.
- Use the private upload tools for gallery or profile-picture uploads. Bytes transfer directly to private System storage.
- Do not place image bytes, temporary download URLs, or storage keys in model-visible content.
- Do not claim an upload succeeded until the refreshed authenticated record shows it.

## Conversation catch-up

- For a new fronting entry named by the user: search authenticated `list_alters` records first, and continue only when exactly one active result has the exact requested name. Stop visibly on no exact match or ambiguity; never choose by tone, aliases, history, or a similarly named profile. After separately confirmed fronting, start that exact profile's episode. Do not use this workflow to set hosting or infer current fronting.
- For that exact new episode, call `prepare_conversation_catch_up` with its returned alterId and periodId. A FRONTING result must be labeled `RECORDED_FRONTING_WINDOW`; it uses that same profile's most recent prior recorded fronting end and the recorded arrival. It is a bounded coverage candidate, never proof of absence, replacement, or current fronting. `NEEDS_DATES`, `HOST_REQUIRED`, malformed history, no prior record, or unavailable history are explicit stop states: do not fabricate a summary.
- A capable external ChatGPT/Codex host—not DIDdy—may use its configured low-cost Luna-class summarizer to draft a very brief catch-up from AI-harness activity it can actually read inside that interval. DIDdy does not buy, select, or call an external model API. Read messages rather than only titles; retain no raw transcripts. Identify the source client, list sources, and state gaps.
- For a fronting arrival, use its returned catchUp session. Page through get_episode_records until nextCursor is null. Read get_episode_review for expectedRevision. Compose a draft with overview, attention now, and significant changes from available context. Distinguish DIDdy, memory, and conversation references and disclose gaps. The user must review the draft and explicitly authorize the write before `save_episode_review_v1` with the exact session and alterId. When the previous end is unknown, use available records without inventing a date or duration. The website reads this saved review; it never generates it or accesses ChatGPT memory. Reuse requestId on retries; a failed review save does not undo the switch. This episode workflow supersedes the legacy summary-save instructions below for fronting episodes.

- An explicit self-identification or check-in can offer conversation catch-up; it never changes current-front state. Switch front only after separate explicit confirmation.
- After a successful `start_fronting_episode`, call `prepare_conversation_catch_up` with the returned alterId and periodId. For a legacy switch, use the returned current alterId and frontingSessionId. For `set_system_host`, read `get_current_presence` and proceed only when the hosting alter and startedAt match the mutation alterId and recordedAt; reaffirmations and later arrivals do not qualify. Ends and clearing hosting do not trigger a summary. Replays do not repeat a completed summary; an interrupted handoff may resume with the original source ID.
- Use the known IANA time zone, or UTC when unknown. The window starts at this alter's previous recorded departure of the same kind and ends at the recorded arrival, not a later read time. Show elapsedSeconds as a readable duration alongside the dates. This window does not prove absence from other experiences. If no prior departure exists, label the boundary unknown and use available records without inventing one.
- For a separate explicit catch-up request, resolve the named profile with `list_alters`, then call `prepare_conversation_catch_up` with an IANA time zone and the selected periodId for hosting/fronting windows. If several periods are open, ask the user to choose. Use an explicit complete `startAt`/`endAt` correction when supplied. A recorded-fronting window is only a candidate, never proof of absence.
- Explicit timestamp offsets are authoritative for the returned instants; the IANA time zone is display context and is never used to reinterpret those offsets.
- System does not automatically receive ChatGPT history. Generate only a reviewable draft from available messages in the returned window and report topics, decisions, open matters, source links, and coverage gaps. Never rely only on titles.
- If host history access is unavailable, say that DIDdy supplied dates but this host cannot retrieve other conversations; offer selected conversations or a capable host. Do not claim that nothing happened, fabricate a summary, or persist raw transcripts in System.

- After the user explicitly approves a grounded draft, call `save_conversation_catch_up` with its alterId, exact startAt/endAt/timeZone, synthesis (including source links), and coverage gaps. Save for 30 days from creation; reuse the same requestId for retries so they never renew retention. Do not save raw transcripts or fabricated summaries when history is unavailable. Report success only after the save succeeds.
- Retrieve retained summaries with `list_conversation_catch_ups` and `get_conversation_catch_up`; expired summaries are unavailable. These are historical syntheses, never new source evidence or proof of current facts. Use `delete_conversation_catch_up` when the user requests early deletion.

## Privacy boundary

- Treat profiles, notes, todos, decisions, threads, fronting state, and photos as private owner-scoped records.
- Never retain raw conversation text as an important thread. Store only the human-approved link and summary fields.
- Keep current front distinct from coverage history, catch-up review state, and unconfirmed coverage drafts.
