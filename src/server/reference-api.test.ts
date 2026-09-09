import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceApiService, type ReferenceCredential, type ReferenceImage, type ReferenceProfile, type ReferenceRepository, sha256 } from "@/server/reference-api";

const owner = "auth0:owner";
const selected = "11111111-1111-4111-8111-111111111111";
const profile: ReferenceProfile = { id: selected, version: 7, name: "Mouse Arcade", pronouns: "they/them", species: "mouse", visualDescription: "soft gray fur", presentation: null, signatureTraits: ["round ears"], imageDoNotChange: ["tail"], profilePictureId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", appearanceReferenceImageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const images: ReferenceImage[] = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", alterId: selected, storageKey: "mouse-profile", contentType: "image/png", version: 3, role: "profilePicture" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", alterId: selected, storageKey: "mouse-reference", contentType: "image/webp", version: 2, role: "appearanceReference" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", alterId: selected, storageKey: "unselected-gallery", contentType: "image/png", version: 1, role: "profilePicture" },
];

class MemoryReferenceRepository implements ReferenceRepository {
  records: (ReferenceCredential & { tokenHash: string })[] = [];
  touched: string[] = [];
  async create(ownerId: string, label: string, tokenHash: string, alterIds: string[]) {
    const credential = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", ownerId, label, selectedAlterIds: alterIds, createdAt: "2026-09-09T00:00:00.000Z", revokedAt: null, lastUsedAt: null, tokenHash };
    this.records.push(credential); return { ...credential };
  }
  async list(ownerId: string) { return this.records.filter((record) => record.ownerId === ownerId).map(({ tokenHash: _hash, ...record }) => ({ ...record })); }
  async revoke(ownerId: string, credentialId: string) { const record = this.records.find((item) => item.ownerId === ownerId && item.id === credentialId); if (!record) return false; record.revokedAt = "2026-09-09T01:00:00.000Z"; return true; }
  async findActiveByHash(tokenHash: string) { const record = this.records.find((item) => item.tokenHash === tokenHash && !item.revokedAt); return record ? { ...record } : null; }
  async profilesForSelection(ownerId: string, ids: string[]) { return ownerId === owner && ids.includes(selected) ? [profile] : []; }
  async imagesForSelection(ownerId: string, ids: string[]) { return ownerId === owner && ids.includes(selected) ? images.slice(0, 2) : []; }
  async touch(id: string) { this.touched.push(id); }
}

function fixture() {
  const repository = new MemoryReferenceRepository();
  const bytes = new Map([["mouse-profile", new Uint8Array([1, 2, 3])], ["mouse-reference", new Uint8Array([4, 5, 6])], ["unselected-gallery", new Uint8Array([7])]]);
  const service = new ReferenceApiService(repository, async (key) => ({ body: bytes.get(key)!, contentType: "image/png" }));
  return { repository, service };
}

test("reference credentials store only a hash and issue a high-entropy secret once", async () => {
  const { repository, service } = fixture();
  const issued = await service.issue(owner, { label: "Working Monkey", selectedAlterIds: [selected] });
  assert.match(issued.secret, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(repository.records[0].tokenHash, sha256(issued.secret));
  assert.ok(!JSON.stringify(await service.list(owner)).includes(issued.secret));
});

test("manifest exactly follows the Working Monkey reference contract", async () => {
  const { service } = fixture();
  const { secret } = await service.issue(owner, { label: "Working Monkey", selectedAlterIds: [selected] });
  const manifest = await service.manifest(secret, "https://bunch.example");
  assert.deepEqual(Object.keys(manifest).sort(), ["alters", "images", "manifestVersion", "origin", "selectedAlterIds"]);
  assert.equal(manifest.origin, "https://bunch.example");
  assert.equal(manifest.manifestVersion, 1);
  assert.deepEqual(manifest.selectedAlterIds, [selected]);
  assert.deepEqual(manifest.images.map((image) => image.id), images.slice(0, 2).map((image) => image.id));
  assert.deepEqual(manifest.images.map((image) => image.alterId), [selected, selected]);
  assert.equal(manifest.images[0].sha256, sha256(new Uint8Array([1, 2, 3])));
  assert.match(manifest.alters[0].sha256, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(manifest);
  for (const prohibited of ["note", "task", "presence", "history", "preference", "storageKey", "work"]) assert.equal(serialized.toLowerCase().includes(prohibited), false);
});

test("an authorized image can be read but unselected gallery material cannot", async () => {
  const { service } = fixture();
  const { secret } = await service.issue(owner, { label: "Working Monkey", selectedAlterIds: [selected] });
  const image = await service.image(secret, images[0].id);
  assert.deepEqual([...image.bytes], [1, 2, 3]);
  await assert.rejects(() => service.image(secret, images[2].id), /not authorized/i);
});

test("revocation and lost selection deny every subsequent request", async () => {
  const { repository, service } = fixture();
  const issued = await service.issue(owner, { label: "Working Monkey", selectedAlterIds: [selected] });
  assert.equal(await service.revoke(owner, issued.id), true);
  await assert.rejects(() => service.manifest(issued.secret, "https://bunch.example"), /invalid or revoked/i);
  const next = await service.issue(owner, { label: "Working Monkey 2", selectedAlterIds: [selected] });
  repository.profilesForSelection = async () => [];
  await assert.rejects(() => service.manifest(next.secret, "https://bunch.example"), /selection is no longer available/i);
});
