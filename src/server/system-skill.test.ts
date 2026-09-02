import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createMcpServer } from "@/server/mcp-server";
import { SYSTEM_SKILL_TEXT, SYSTEM_SKILL_URI, systemSkillEntry } from "@/server/system-skill";
import type { SystemService } from "@/server/system-service";

const skillListResultSchema = z.object({
  skills: z.array(z.object({
    uri: z.string(),
    frontmatter: z.record(z.string(), z.unknown()),
    resources: z.array(z.object({ uri: z.string(), digest: z.string() })),
  })),
});

const skillGetResultSchema = z.object({ skill: skillListResultSchema.shape.skills.element });

test("MCP advertises and serves the System Companion skill snapshot", async () => {
  const repoSkill = await readFile(new URL("../../skills/system-companion/SKILL.md", import.meta.url), "utf8");
  assert.equal(repoSkill, SYSTEM_SKILL_TEXT);
  assert.match(systemSkillEntry().resources[0].digest, /^sha256:[a-f0-9]{64}$/);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("test:skill", {} as SystemService);
  const client = new Client({ name: "skill-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.deepEqual(client.getServerCapabilities()?.extensions?.["io.modelcontextprotocol/skills"], {});
    const listed = await client.request({ method: "skills/list", params: {} }, skillListResultSchema);
    assert.equal(listed.skills[0].uri, SYSTEM_SKILL_URI);
    const fetched = await client.request({ method: "skills/get", params: { uri: SYSTEM_SKILL_URI } }, skillGetResultSchema);
    assert.equal(fetched.skill.frontmatter.name, "system-companion");
    const resource = await client.readResource({ uri: SYSTEM_SKILL_URI });
    assert.equal(resource.contents[0].uri, SYSTEM_SKILL_URI);
    assert.equal("text" in resource.contents[0] ? resource.contents[0].text : undefined, SYSTEM_SKILL_TEXT);
  } finally {
    await client.close();
    await server.close();
  }
});
