import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SYSTEM_SKILL_URI = "skill://system-companion/system-companion/SKILL.md";
export const SYSTEM_SKILL_TEXT = "---\nname: system-companion\ndescription: Use the private System MCP companion for explicit current-front switches, catch-up, notes, todos, decisions, important threads, and private media.\n---\n\n# System Companion\n\nUse the authenticated System MCP tools as the source of truth. Preserve alter names exactly and use stable IDs returned by the tools.\n\n## Hosting, fronting episodes, and legacy catch-up\n\n- For \u201cwho was out when\u201d or historical fronting questions, call list_fronting_history. Resolve a named profile with list_alters; use explicit-offset from/to instants for the requested local date range and follow nextCursor as before. Report kind and origin: HOSTING, FRONTING, or unclassified LEGACY_FRONT. A missing end means no end was recorded, and gaps do not prove absence.\n- Never infer who is fronting from writing style, topic, mood, or prior history.\n- Hosting means responsibility for everything otherwise unclaimed throughout the period out. Fronting episodes may overlap a host and each other and end independently. Hours versus days are examples, never expiry rules.\n- Use get_current_presence to read both kinds. Only an explicit report of fronting authorizes start_fronting_episode; only an explicit end authorizes end_fronting_episode with the episode ID and version. Use set_system_host for explicit hosting changes.\n- Do not classify legacy front records as hosting or an overlapping episode without user confirmation.\n- Call `get_current_front`, resolve the target with `list_alters`, then call `switch_current_front` only for an explicitly requested legacy exclusive switch. New episodes use start_fronting_episode.\n- For saved-record catch-up, read get_current_presence and let the user select a hosting or fronting periodId when more than one is open. Pass that ID to get_catch_up or render_system_companion. These windows do not prove absence.\n- After a successful explicit switch, offer `render_system_companion` or `get_catch_up`. Do not interrupt an unrelated active chat.\n- When the user asks to see the lineup, all alters, avatars, or profile pictures, call `render_alter_lineup`. Do not substitute image counts or filenames for rendered profile pictures.\n- Catch-up is recipient-scoped but owner-visible. It includes direct notes, assigned or System-wide todos, decisions, confirmed important threads, and urgent carryover.\n- `set_catch_up_item_state` changes only New, Acknowledged, Deferred, or Resolved review state. It never closes or edits the underlying record.\n- A deferred item must return later today, tomorrow, at the next recorded period, or at a custom time.\n\n## Notes, todos, and decisions\n\n- Create a note or todo only when the user explicitly asks. Preserve approved wording.\n- Use `alterId` for the note recipient or subject. Use `actorAlterId` only when the user explicitly names the author.\n- Use `create_system_decision` when the user approves a first-class decision, next action, author if named, and recipients.\n- Generate a fresh UUID for every `requestId`. Reuse it only when retrying the same mutation.\n\n## Important threads\n\n- At an explicit decision or action moment, the assistant may offer \u201cSave this thread?\u201d without interrupting the current work.\n- Do not write until the user accepts.\n- First call `suggest_important_thread` with the link, approved summary, key decision or action, who flagged it, and recipients. Never store a transcript.\n- Call `confirm_important_thread` only after the user confirms those fields. Suggested threads do not enter catch-up.\n\n## Private photos\n\n- Use `open_private_photo_gallery` or the website's Profiles & Media surface for viewing photos.\n- Use the private upload tools for gallery or profile-picture uploads. Bytes transfer directly to private System storage.\n- Do not place image bytes, temporary download URLs, or storage keys in model-visible content.\n- Do not claim an upload succeeded until the refreshed authenticated record shows it.\n\n## Conversation catch-up\n\n- An explicit self-identification or check-in can offer conversation catch-up; it never changes current-front state. Switch front only after separate explicit confirmation.\n- For an explicit catch-up request, resolve the named profile with `list_alters`, then call `prepare_conversation_catch_up` with an IANA time zone and the selected periodId for hosting/fronting windows. If several periods are open, ask the user to choose. Use an explicit complete `startAt`/`endAt` correction when supplied. A recorded-fronting window is only a candidate, never proof of absence.\n- Explicit timestamp offsets are authoritative for the returned instants; the IANA time zone is display context and is never used to reinterpret those offsets.\n- System does not automatically receive ChatGPT history. A capable host may read available messages in the returned window and report topics, decisions, open matters, source links, and coverage gaps. Never rely only on titles.\n- If host history access is unavailable, say that DIDdy supplied dates but this host cannot retrieve other conversations; offer selected conversations or a capable host. Do not claim that nothing happened, fabricate a summary, or persist raw transcripts/generated summaries in System.\n\n## Privacy boundary\n\n- Treat profiles, notes, todos, decisions, threads, fronting state, and photos as private owner-scoped records.\n- Never retain raw conversation text as an important thread. Store only the human-approved link and summary fields.\n- Keep current front distinct from coverage history, catch-up review state, and unconfirmed coverage drafts.\n";

const frontmatter = {
  name: "system-companion",
  description: "Use the private System MCP companion to read and leave notes, record explicit current-front switches, and add photos through the secure ChatGPT widget.",
};

export function systemSkillEntry() {
  return {
    uri: SYSTEM_SKILL_URI,
    frontmatter,
    resources: [{
      uri: SYSTEM_SKILL_URI,
      digest: `sha256:${createHash("sha256").update(SYSTEM_SKILL_TEXT, "utf8").digest("hex")}`,
    }],
  };
}

const skillsListRequestSchema = z.object({
  method: z.literal("skills/list"),
  params: z.object({ cursor: z.string().optional() }).optional(),
});

const skillsGetRequestSchema = z.object({
  method: z.literal("skills/get"),
  params: z.object({ uri: z.string() }),
});

export function registerSystemSkill(server: McpServer) {
  server.server.registerCapabilities({ extensions: { "io.modelcontextprotocol/skills": {} } });
  server.registerResource(
    "system-companion-skill",
    SYSTEM_SKILL_URI,
    { title: "System Companion skill", description: frontmatter.description, mimeType: "text/markdown" },
    async () => ({ contents: [{ uri: SYSTEM_SKILL_URI, mimeType: "text/markdown", text: SYSTEM_SKILL_TEXT }] }),
  );
  server.server.setRequestHandler(skillsListRequestSchema, async () => ({ skills: [systemSkillEntry()] }) as never);
  server.server.setRequestHandler(skillsGetRequestSchema, async ({ params }) => {
    if (params.uri !== SYSTEM_SKILL_URI) throw new Error("Skill not found.");
    return { skill: systemSkillEntry() } as never;
  });
}
