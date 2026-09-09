import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD form.");
export const todoStatusSchema = z.enum(["INBOX", "OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]);
export const todoPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
export const recordSourceSchema = z.enum(["MCP", "WEB", "SYSTEM"]);
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const galleryShareLifetimeSchema = z.enum(["1h", "2h", "4h", "1d", "1w", "forever"]);
export const galleryShareFrontingSchema = z.object({ showCurrentFronting: z.boolean() }).strict();
export const galleryShareCreateSchema = z.object({ duration: galleryShareLifetimeSchema }).strict();

const shortOptional = z.string().trim().max(500).optional();
const textOptional = z.string().trim().max(5000).optional();
const stringList = z.array(z.string().trim().min(1).max(500)).max(100);

export const visualIdentitySchema = z.object({
  species: shortOptional,
  visualDescription: z.string().trim().max(1000).optional(),
  presentation: shortOptional,
  signatureTraits: stringList.optional(),
  styleTags: stringList.optional(),
  imageDoNotChange: stringList.optional(),
});

export const alterCreateSchema = z.object({
  ...visualIdentitySchema.shape,
  requestId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  pronouns: shortOptional,
  selfDescribedGender: shortOptional,
  description: textOptional,
  communicationGuidance: textOptional,
  strengths: stringList.optional(),
  boundaries: stringList.optional(),
}).strict();

export const alterPatchSchema = z.object({
  ...visualIdentitySchema.shape,
  species: z.string().trim().max(500).nullable().optional(),
  visualDescription: z.string().trim().max(1000).nullable().optional(),
  presentation: z.string().trim().max(500).nullable().optional(),
  requestId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  pronouns: z.string().trim().max(500).nullable().optional(),
  selfDescribedGender: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  communicationGuidance: z.string().trim().max(5000).nullable().optional(),
  strengths: stringList.optional(),
  boundaries: stringList.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["requestId", "expectedVersion"].includes(key)), "Provide at least one field to update.");

export const todoCreateSchema = z.object({
  requestId: uuidSchema,
  title: z.string().trim().min(1).max(500),
  details: textOptional,
  status: todoStatusSchema.optional(),
  dueOn: isoDateSchema.optional(),
  priority: todoPrioritySchema.optional(),
  assigneeAlterIds: z.array(uuidSchema).max(100).optional(),
  coverageId: uuidSchema.optional(),
}).strict();

export const todoPatchSchema = z.object({
  requestId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(500).optional(),
  details: z.string().trim().max(5000).nullable().optional(),
  status: todoStatusSchema.optional(),
  dueOn: isoDateSchema.nullable().optional(),
  priority: todoPrioritySchema.nullable().optional(),
  assigneeAlterIds: z.array(uuidSchema).max(100).optional(),
  coverageId: uuidSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["requestId", "expectedVersion"].includes(key)), "Provide at least one field to update.");

export const noteCreateSchema = z.object({
  requestId: uuidSchema,
  body: z.string().trim().min(1).max(5000),
  alterId: uuidSchema.optional(),
  coverageId: uuidSchema.optional(),
  actorAlterId: uuidSchema.optional(),
}).strict();

export const frontingSwitchSchema = z.object({
  requestId: uuidSchema,
  alterId: uuidSchema,
  expectedCurrentVersion: z.number().int().positive().nullable(),
  // Bind newer clients to the exact session, since row versions restart at 1.
  expectedCurrentSessionId: uuidSchema.nullable().optional(),
  switchedAt: isoTimestampSchema.optional(),
}).strict();

export const versionMutationSchema = z.object({ requestId: uuidSchema, expectedVersion: z.number().int().positive() }).strict();
export const eraseAlterSchema = versionMutationSchema.extend({ previewToken: z.string().min(1) }).strict();
export const listPageSchema = z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(25), includeArchived: z.boolean().default(false) }).strict();
export const listAltersSchema = listPageSchema.extend({ search: z.string().trim().min(1).max(120).optional() }).strict();
export const listNotesSchema = listPageSchema.pick({ cursor: true, limit: true }).extend({
  alterId: uuidSchema.optional(),
  actorAlterId: uuidSchema.optional(),
}).strict();

export const profileImageViewSchema = z.object({
  id: uuidSchema,
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  isProfilePicture: z.boolean(),
  createdAt: z.string().datetime(),
});

export const setProfilePictureSchema = z.object({
  imageId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  requestId: uuidSchema,
}).strict();
export const setAlterAppearanceSchema = z.object({
  appearanceNotes: z.string().trim().max(5000).nullable().optional(),
  referenceImageIds: z.array(uuidSchema).max(12),
  expectedVersion: z.number().int().positive(),
  requestId: uuidSchema,
}).strict();
export const prepareFurryTransformSchema = z.object({
  alterName: z.string().trim().min(1).max(120),
}).strict();
export const listTodosSchema = listPageSchema.extend({
  status: z.array(todoStatusSchema).max(6).optional(),
  assigneeAlterId: uuidSchema.optional(),
  dueFrom: isoDateSchema.optional(),
  dueTo: isoDateSchema.optional(),
  priority: z.array(todoPrioritySchema).max(3).optional(),
  coverageId: uuidSchema.optional(),
}).strict();

export const alterViewSchema = z.object({
  ...visualIdentitySchema.shape,
  id: uuidSchema,
  name: z.string(),
  aliases: z.array(z.string()),
  pronouns: z.string().optional(),
  selfDescribedGender: z.string().optional(),
  description: z.string().optional(),
  appearanceNotes: z.string().optional(),
  communicationGuidance: z.string().optional(),
  strengths: z.array(z.string()),
  boundaries: z.array(z.string()),
  imageCount: z.number().int().nonnegative(),
  profilePicture: profileImageViewSchema.optional(),
  images: z.array(profileImageViewSchema),
  appearanceReferenceImageIds: z.array(uuidSchema),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
});

export const todoViewSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  details: z.string().optional(),
  status: todoStatusSchema,
  dueOn: isoDateSchema.optional(),
  priority: todoPrioritySchema.optional(),
  assigneeAlterIds: z.array(uuidSchema),
  coverageId: uuidSchema.optional(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
});

export const frontingSessionViewSchema = z.object({
  id: uuidSchema,
  alterId: uuidSchema,
  alterName: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  version: z.number().int().positive(),
});

export const noteViewSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  alterId: uuidSchema.optional(),
  alterName: z.string().optional(),
  coverageId: uuidSchema.optional(),
  actorAlterId: uuidSchema.optional(),
  actorAlterName: z.string().optional(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const responseMetaSchema = z.object({ requestId: uuidSchema.optional(), nextCursor: z.string().optional(), replayed: z.boolean().optional() });
export const alterResponseSchema = z.object({ data: alterViewSchema, meta: responseMetaSchema });
export const alterListResponseSchema = z.object({ data: z.array(alterViewSchema), meta: responseMetaSchema });
export const todoResponseSchema = z.object({ data: todoViewSchema, meta: responseMetaSchema });
export const todoListResponseSchema = z.object({ data: z.array(todoViewSchema), meta: responseMetaSchema });
export const currentFrontResponseSchema = z.object({ data: frontingSessionViewSchema.nullable(), meta: responseMetaSchema });
export const switchFrontResponseSchema = z.object({
  data: z.object({ current: frontingSessionViewSchema, previous: frontingSessionViewSchema.nullable() }),
  meta: responseMetaSchema,
});
export const noteResponseSchema = z.object({ data: noteViewSchema, meta: responseMetaSchema });
export const noteListResponseSchema = z.object({ data: z.array(noteViewSchema), meta: responseMetaSchema });

export type AlterCreate = z.infer<typeof alterCreateSchema>;
export type AlterPatch = z.infer<typeof alterPatchSchema>;
export type TodoCreate = z.infer<typeof todoCreateSchema>;
export type TodoPatch = z.infer<typeof todoPatchSchema>;
export type NoteCreate = z.infer<typeof noteCreateSchema>;
export type AlterView = z.infer<typeof alterViewSchema>;
export type TodoView = z.infer<typeof todoViewSchema>;
export type NoteView = z.infer<typeof noteViewSchema>;
export type FrontingSwitch = z.infer<typeof frontingSwitchSchema>;
export type FrontingSessionView = z.infer<typeof frontingSessionViewSchema>;
export type ProfileImageView = z.infer<typeof profileImageViewSchema>;
export type SetProfilePicture = z.infer<typeof setProfilePictureSchema>;
export type SetAlterAppearance = z.infer<typeof setAlterAppearanceSchema>;
export type TodoStatus = z.infer<typeof todoStatusSchema>;
export type TodoPriority = z.infer<typeof todoPrioritySchema>;
export type RecordSource = z.infer<typeof recordSourceSchema>;
export type ListAltersInput = z.input<typeof listAltersSchema>;
export type ListTodosInput = z.input<typeof listTodosSchema>;
export type ListNotesInput = z.input<typeof listNotesSchema>;
