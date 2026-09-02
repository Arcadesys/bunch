import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SYSTEM_SKILL_URI = "skill://system-companion/system-companion/SKILL.md";
export const SYSTEM_SKILL_TEXT = "---\nname: system-companion\ndescription: Use the private System MCP companion to read and leave notes, record explicit current-front switches, and add photos through the secure ChatGPT widget.\n---\n\n# System Companion\n\nUse the authenticated System MCP tools as the source of truth. Preserve alter names exactly and use stable IDs returned by the tools.\n\n## Notes\n\n- Read notes with `list_system_notes`. Resolve people by name or alias with `list_alters` before filtering or writing.\n- Create a note with `create_system_note` only when the user explicitly asks to leave or save it.\n- Keep the note body exactly as supplied unless the user asks for editing.\n- Use `alterId` for whom or what the note is linked to. Use `actorAlterId` only when the user explicitly says who the note is from.\n- Generate a fresh UUID for `requestId`. Reuse that UUID only when retrying the same intended mutation.\n\n## Current-front switches\n\n- Never infer who is fronting from writing style, topic, mood, or prior history.\n- Record a switch only when the user explicitly confirms that an alter is now fronting.\n- Call `get_current_front`, then resolve the target with `list_alters`.\n- Call `switch_current_front` with the current version, or `null` when no current front exists.\n- Include `switchedAt` only when the user supplies or confirms a time. Otherwise let the server record the current time.\n- Report the confirmed server result, including any conflict, instead of claiming the switch from intent alone.\n\n## Private photos\n\n- Use `render_system_companion` when the user wants to add a photo.\n- Ask the user to choose the profile and image in the companion widget. The widget obtains a short-lived upload capability and transfers the bytes directly to private System storage.\n- Do not place image bytes, temporary download URLs, or storage keys in model-visible notes or tool arguments.\n- Do not claim an upload succeeded until the widget refresh shows the profile's updated private-image count.\n\n## Privacy boundary\n\n- Treat profiles, notes, fronting state, and photos as private owner-scoped records.\n- Never retain raw conversation text unless the user explicitly asks for a specific note whose body they approve.\n- Keep current front distinct from coverage history and unconfirmed coverage drafts.\n";

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
