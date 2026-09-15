import { Pool } from "pg";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

export const testPeople = [
  { id: "10000000-1111-4111-8111-111111111111", imageId: "20000000-1111-4111-8111-111111111111", name: "Test Amber Fox", species: "anthropomorphic fox", color: "#df7e26", ears: '<path d="M170 180 145 55 250 140M310 180 340 55 235 140" fill="#df7e26" stroke="#152030" stroke-width="10"/>', trait: "orange fur, pointed ears, long bushy tail and a blue scarf" },
  { id: "10000000-2222-4222-8222-222222222222", imageId: "20000000-2222-4222-8222-222222222222", name: "Test Violet Rabbit", species: "anthropomorphic rabbit", color: "#ae8bd1", ears: '<ellipse cx="195" cy="110" rx="25" ry="90" fill="#ae8bd1" stroke="#152030" stroke-width="10"/><ellipse cx="285" cy="110" rx="25" ry="90" fill="#ae8bd1" stroke="#152030" stroke-width="10"/>', trait: "lavender fur, long upright rabbit ears, round tail and a blue scarf" },
  { id: "10000000-3333-4333-8333-333333333333", imageId: "20000000-3333-4333-8333-333333333333", name: "Test Teal Cat", species: "anthropomorphic cat", color: "#4bb1ac", ears: '<path d="M170 180 160 85 240 140M310 180 320 85 240 140" fill="#4bb1ac" stroke="#152030" stroke-width="10"/>', trait: "teal fur, triangular cat ears, long thin tail and a blue scarf" },
];

export default async function setup() {
  const pool = new Pool({ connectionString: process.env.GROUP_PHOTO_TEST_CONNECTION });
  try {
    await pool.query("create schema if not exists group_photo_finish_e2e");
    if (!(await pool.query("select to_regclass('group_photo_finish_e2e.app_user') as existing")).rows[0].existing) {
      await pool.query(await readFile("db/baseline.sql", "utf8"));
      for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    }
    await mkdir("private-uploads", { recursive: true });
    await mkdir("test-results/group-photo-fixtures", { recursive: true });
    await pool.query("insert into app_user(id,google_subject) values('demo:local-user','demo:local-user') on conflict do nothing");
    for (const person of testPeople) {
      const key = `finisher-fixture-${person.id}.png`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="#f5f0e4"/>${person.ears}<ellipse cx="240" cy="385" rx="85" ry="140" fill="${person.color}" stroke="#152030" stroke-width="10"/><circle cx="240" cy="225" r="90" fill="${person.color}" stroke="#152030" stroke-width="10"/><ellipse cx="205" cy="215" rx="10" ry="17" fill="#152030"/><ellipse cx="275" cy="215" rx="10" ry="17" fill="#152030"/><ellipse cx="240" cy="255" rx="35" ry="25" fill="#fff"/><circle cx="240" cy="248" r="10" fill="#152030"/><path d="M170 307H305V337H270V405H235V337H170Z" fill="#185dc4"/><path d="M190 485V590M290 485V590" stroke="${person.color}" stroke-width="55" stroke-linecap="round"/></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(`private-uploads/${key}`);
      await pool.query("insert into alter_profile(id,owner_id,name,species,visual_description,image_do_not_change) values($1,'demo:local-user',$2,$3,$4,ARRAY['blue scarf','recorded species','recorded fur color']) on conflict(id) do nothing", [person.id, person.name, person.species, `Adult ${person.species} with ${person.trait}. Simple clean illustrated style.`]);
      await pool.query("insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,'demo:local-user',$2,$3,'image/png') on conflict(id) do nothing", [person.imageId, person.id, key]);
      await pool.query("insert into alter_appearance_reference(owner_id,alter_id,image_id) values('demo:local-user',$1,$2) on conflict do nothing", [person.id, person.imageId]);
    }
    const scene = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#98cef1"/><circle cx="1000" cy="100" r="55" fill="#ffeb92"/><path d="M0 420Q250 290 500 420T1200 400V800H0Z" fill="#89b464"/><path d="M0 530Q600 470 1200 560V800H0Z" fill="#d4ba8c"/><path d="M760 450H1150M780 460V550M1130 460V550" stroke="#714e36" stroke-width="26"/></svg>';
    await sharp(Buffer.from(scene)).png().toFile("test-results/group-photo-fixtures/scene.png");
    await writeFile("test-results/group-photo-fixtures/README.txt", "Synthetic identity references and a park background for the real-provider acceptance run. These are test fixtures, not a generated result.\n");
  } finally { await pool.end(); }
}
