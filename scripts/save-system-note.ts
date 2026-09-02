import { Client } from "pg";
import { repository } from "@/server/repository";

function valueAfter(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const recipientName = valueAfter("--to");
  const actorName = valueAfter("--from");
  const body = valueAfter("--body");
  if (!recipientName || !actorName || !body) throw new Error("Usage: save-system-note --to <alter> --from <alter> --body <text>");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const profiles = await client.query<{ id: string; owner_id: string; name: string }>(
      `select id, owner_id, name from alter_profile
       where archived_at is null and (lower(name) = lower($1) or lower(name) = lower($2))
       order by name`,
      [recipientName, actorName],
    );
    const recipients = profiles.rows.filter((row) => row.name.toLowerCase() === recipientName.toLowerCase());
    const actors = profiles.rows.filter((row) => row.name.toLowerCase() === actorName.toLowerCase());
    if (recipients.length !== 1) throw new Error(`Expected exactly one active profile named ${recipientName}; found ${recipients.length}.`);
    if (actors.length !== 1) throw new Error(`Expected exactly one active profile named ${actorName}; found ${actors.length}.`);
    const recipient = recipients[0];
    const actor = actors[0];
    if (recipient.owner_id !== actor.owner_id) throw new Error("The recipient and actor do not share an owner.");

    const existing = await client.query<{ id: string }>(
      `select n.id from system_note n
       join activity_event ae on ae.owner_id = n.owner_id and ae.entity_type = 'NOTE' and ae.entity_id = n.id and ae.action = 'CREATED'
       where n.owner_id = $1 and n.alter_id = $2::uuid and n.body = $3 and ae.actor_alter_id = $4::uuid
       limit 1`,
      [recipient.owner_id, recipient.id, body, actor.id],
    );
    if (existing.rowCount) {
      console.log(`${recipient.name} already has this exact note from ${actor.name}; no changes made.`);
      return;
    }

    await repository.saveNote(recipient.owner_id, { body, alterId: recipient.id, actorAlterId: actor.id });
    console.log(`Saved one note for ${recipient.name} from ${actor.name}.`);
  } finally {
    await client.end();
  }
}

void main();
