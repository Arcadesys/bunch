// The MCP tool surface that a ChatGPT app drives. Every tool closes over an ownerId
// derived from a verified access token, never from tool input, so a model cannot ask
// for another owner's records by naming them.

import { compositionGuidance } from "@/domain/group-photo";
import { defaultStickerPack, stickerPackDraftSchema } from "@/domain/sticker-pack";
import { connectPrivateSystemTool, registerDemoSystemTool } from "./demo-mcp-server";
import { ACCOUNT_PROFILE_TOOL_NAME, accountProfileId, accountProfileTool } from "./mcp-account-profile";
import { furrySceneInputSchema, imagePromptInputSchema, imagePromptResultSchema } from "@/domain/image-prompt";
import { chatgptAlterImageInputSchema, chatgptAlterImageResultSchema } from "@/domain/chatgpt-alter-image";
import { prepareAlterImagePrompt, prepareFurryScene } from "@/server/image-prompt";
import { prepareChatgptAlterImage } from "@/server/chatgpt-alter-image";
import { getGroupPhotoService } from "@/server/group-photo-service";
import { ConversationSummaryService } from "./conversation-summary-service";
import { saveEpisodeReviewSchema, saveConversationSummarySchema, conversationSummarySchema, listConversationSummariesSchema } from "@/domain/conversation-summary";
import { currentPresenceResponseSchema, startFrontingEpisodeSchema, endFrontingEpisodeSchema, presencePeriodResponseSchema } from "@/domain/presence";
import { frontingHistoryQuerySchema, frontingHistoryResponseSchema } from "@/domain/fronting-history";
import { setSystemHostSchema, systemHostResponseSchema } from "@/domain/host";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { suggestCoverage } from "@/domain/coverage";
import {
  alterCreateSchema,
  alterListResponseSchema,
  alterPatchSchema,
  alterResponseSchema,
  alterViewSchema,
  eraseAlterSchema,
  currentFrontResponseSchema,
  frontingSessionViewSchema,
  frontingSwitchSchema,
  listAltersSchema,
  listNotesSchema,
  listTodosSchema,
  noteCreateSchema,
  notePatchSchema,
  checklistCreateSchema,
  checklistPatchSchema,
  noteListResponseSchema,
  noteResponseSchema,
  noteViewSchema,
  responseMetaSchema,
  todoCreateSchema,
  todoListResponseSchema,
  todoPatchSchema,
  todoResponseSchema,
  todoViewSchema,
  switchFrontResponseSchema,
  uuidSchema,
  versionMutationSchema,
} from "@/domain/contracts";
import { issueImageReadCapability, issueImageUploadCapability, issueSceneImageReadCapability } from "@/server/mcp-authorization";
import { setAlterAppearanceSchema } from "@/domain/contracts";
import { repository, type SystemRepository } from "@/server/repository";
import { draftSchema, noteSchema, preferenceSchema, resolveDraftSchema } from "@/server/schemas";
import { registerSystemSkill } from "@/server/system-skill";
import { getSystemService } from "@/server/system-service";
import { CatchUpService, getCatchUpService } from "@/server/catch-up-service";
import { importantThreadCreateSchema, catchUpSessionSchema, setCatchUpItemStateSchema, conversationCatchUpHandoffSchema, prepareConversationCatchUpSchema } from "@/domain/catch-up";

import { catchUpWidget } from "@/server/companion-widget";
import { lineupWidget } from "@/server/lineup-widget";
import { sceneWidget } from "@/server/scene-widget";
import { chatgptAlterImageWidget } from "@/server/chatgpt-alter-image-widget";
import { nativeSceneInputSchema, nativeSceneRenderSchema, imageAllowanceSchema, repairSourceSchema, type NativeSceneRender } from "@/domain/native-scene";
import { getNativeSceneService, type NativeSceneService } from "@/server/native-scene-service";
import { getMcpUsageService } from "@/server/mcp-usage-service";
import { getPilotService } from "@/server/pilot-service";
import { randomUUID } from "node:crypto";
import { deletePrivateImages, downloadOpenAIImage, savePrivateImage } from "@/server/private-images";
import { deletableImageKindSchema, getImageDeletionService, type ImageDeletionService } from "@/server/image-deletion";

// The authority in these ui:// URIs is a frozen cache key, not an address. Live
// ChatGPT conversations hold the tool-to-resource mapping and keep requesting the
// exact string they were given, so this list is append-only. Renaming it to match
// current branding would break rendering for every cached conversation.
const WIDGET_URI = "ui://system-arcades-me.vercel.app/companion-v13.html";
const LINEUP_WIDGET_URI = "ui://system-arcades-me.vercel.app/alter-lineup-v3.html";
const SCENE_WIDGET_URI = "ui://system-arcades-me.vercel.app/native-scene-v1.html";
const CHATGPT_ALTER_IMAGE_WIDGET_URI = "ui://system-arcades-me.vercel.app/chatgpt-alter-image-v2.html";
// Existing ChatGPT conversations can retain a render-tool descriptor after an
// app update. Keep the prior URI readable until those cached conversations
// naturally reconnect, while the current tool continues to advertise v13.
const LEGACY_WIDGET_URIS = [
  "ui://system-arcades-me.vercel.app/companion-v10.html",
  "ui://system.arcades.me/companion-v7.html",
  "ui://system.arcades.me/companion-v8.html",
] as const;
const LEGACY_CATCH_UP_WIDGET_URIS = [11, 12].map((version) => `ui://system-arcades-me.vercel.app/companion-v${version}.html`);
const LEGACY_LINEUP_WIDGET_URIS = [1, 2].map((version) => `ui://system-arcades-me.vercel.app/alter-lineup-v${version}.html`);
const LEGACY_CHATGPT_ALTER_IMAGE_WIDGET_URIS = ["ui://system-arcades-me.vercel.app/chatgpt-alter-image-v1.html"] as const;
export const PUBLIC_MCP_UI_RESOURCE_URIS = new Set<string>([
  WIDGET_URI,
  LINEUP_WIDGET_URI,
  SCENE_WIDGET_URI,
  CHATGPT_ALTER_IMAGE_WIDGET_URI,
  ...LEGACY_CATCH_UP_WIDGET_URIS,
  ...LEGACY_LINEUP_WIDGET_URIS,
  ...LEGACY_CHATGPT_ALTER_IMAGE_WIDGET_URIS,
  ...LEGACY_WIDGET_URIS,
]);

export function isPublicMcpUiResourceUri(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_MCP_UI_RESOURCE_URIS.has(value);
}
const coverageSchema = z.object({ id: uuidSchema, ownerId: z.string(), alterId: uuidSchema.optional(), startsOn: z.string().date(), endsOn: z.string().date().optional(), status: z.enum(["DRAFT", "CONFIRMED", "REJECTED"]), reasons: z.array(z.string()), createdAt: z.string().datetime(), confirmedAt: z.string().datetime().optional() });
const legacyNoteViewSchema = z.object({ id: uuidSchema, ownerId: z.string(), body: z.string(), alterId: uuidSchema.optional(), coverageId: uuidSchema.optional(), actorAlterId: uuidSchema.optional(), createdAt: z.string().datetime() });
const preferenceViewSchema = z.object({ key: z.string(), value: z.string(), updatedAt: z.string().datetime() });
const companionStateSchema = z.object({ presence: currentPresenceResponseSchema.shape.data, currentFront: frontingSessionViewSchema.nullable(), profiles: z.array(alterViewSchema), assignments: z.array(coverageSchema), notes: z.array(noteViewSchema), todos: z.array(todoViewSchema), preferences: z.array(preferenceViewSchema) });
const lineupStateSchema = z.object({ presence: currentPresenceResponseSchema.shape.data, currentFront: frontingSessionViewSchema.nullable(), profiles: z.array(alterViewSchema) });
const coverageOutputSchema = z.object({ draft: coverageSchema });
const noteOutputSchema = z.object({ note: legacyNoteViewSchema });
const preferenceOutputSchema = z.object({ preference: preferenceViewSchema });
const privateGalleryOutputSchema = z.object({ url: z.string().url() });
const usageStatsSchema = z.object({
  windowDays: z.number().int(),
  totalInvocations: z.number().int(),
  totalErrors: z.number().int(),
  byTool: z.array(z.object({ tool: z.string(), count: z.number().int(), errors: z.number().int() })),
  byDay: z.array(z.object({ day: z.string(), count: z.number().int() })),
  byOwner: z.array(z.object({ ownerId: z.string(), count: z.number().int() })),
  aiSpend: z.object({
    totalUsd: z.number(), meaningfulActions: z.number().int(), costPerActionUsd: z.number(), activeUserDays: z.number().int(), costPerActiveUserDayUsd: z.number(),
    chargedFailures: z.number().int(), estimatedRows: z.number().int(), economyActions: z.number().int(),
    byAction: z.array(z.object({ action: z.string(), costUsd: z.number(), actions: z.number().int() })),
    byModelQuality: z.array(z.object({ model: z.string(), quality: z.string(), costUsd: z.number(), actions: z.number().int() })),
    byAccount: z.array(z.object({ ownerId: z.string(), costUsd: z.number(), actions: z.number().int() })),
    byDay: z.array(z.object({ day: z.string(), costUsd: z.number(), actions: z.number().int() })),
  }),
});
const importantThreadSuggestionViewSchema = importantThreadCreateSchema.extend({
  id: uuidSchema,
  status: z.literal("SUGGESTED"),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
const importantThreadConfirmationViewSchema = z.object({ id: uuidSchema, status: z.literal("CONFIRMED"), version: z.number().int().positive() });

function companionWidget() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>System companion</title><style>:root{font:18px/1.5 system-ui,sans-serif;color:#101820;background:#fff}body{margin:0;padding:16px}.card{max-width:700px;border:3px solid #101820;padding:18px}h2,h3{line-height:1.1}.notice{background:#eff6ff;border-left:6px solid #075985;padding:10px;font-weight:700}.entry{border-top:2px solid #101820;padding:12px 0}.muted{color:#334155}button,input,select{font:inherit;padding:9px;border:2px solid #101820}button{background:#075985;color:#fff;font-weight:800;cursor:pointer}.secondary{background:#fff;color:#101820}.row{display:flex;gap:10px;flex-wrap:wrap}</style></head><body><main class="card"><h2>System companion</h2><p class="notice" id="notice">Loading authorized records…</p><section><h3>Profiles</h3><div id="profiles" class="muted"></div></section><section><h3>Open to-dos</h3><div id="todos" class="muted"></div></section><section><h3>Coverage drafts</h3><div id="drafts" class="muted"></div></section><section><h3>Private images</h3><p class="muted">Add an image to a selected profile from ChatGPT. The image is transferred into private backend storage, not retained as a ChatGPT record.</p><label>Profile <select id="image-alter"><option value="">Choose a profile</option></select></label><div class="row"><button id="add-image">Select private image</button><button class="secondary" id="refresh">Refresh state</button></div></section></main><script>
const $=id=>document.getElementById(id),pending=new Map();let n=1,state={profiles:[],assignments:[],todos:[]};function esc(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}function tool(name,args){return new Promise((resolve,reject)=>{const id=n++;pending.set(id,{resolve,reject});parent.postMessage({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}},'*');});}function render(data){state=data?.structuredContent||data||state;const ps=state.profiles||[];$('notice').textContent='Authorized private state loaded. Drafts are not history until you confirm.';$('profiles').innerHTML=ps.length?ps.map(p=>'<div class="entry"><strong>'+esc(p.name)+'</strong>'+(p.selfDescribedGender?' · '+esc(p.selfDescribedGender):'')+'<br><span class="muted">'+esc(p.description||'No description added.')+' · '+p.imageCount+' private image(s)</span></div>').join(''):'No profiles yet. Ask ChatGPT to create one.';$('image-alter').innerHTML='<option value="">Choose a profile</option>'+ps.map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');const todos=(state.todos||[]).filter(t=>!['DONE','CANCELLED'].includes(t.status));$('todos').innerHTML=todos.length?todos.map(t=>'<div class="entry">'+esc(t.title)+'</div>').join(''):'No open to-dos.';const drafts=(state.assignments||[]).filter(a=>a.status==='DRAFT');$('drafts').innerHTML=drafts.length?drafts.map(d=>'<div class="entry"><strong>'+esc(d.startsOn)+(d.endsOn?' – '+esc(d.endsOn):' onward')+'</strong><ul>'+d.reasons.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul><span class="muted">Ask ChatGPT to confirm, change, or reject this draft.</span></div>').join(''):'No drafts.';}async function refresh(){try{render(await tool('get_companion_state',{}));}catch(e){$('notice').textContent=e.message||'Unable to refresh.';}}$('refresh').onclick=refresh;async function chooseImage(){if(window.openai?.selectFiles&&window.openai?.getFileDownloadUrl){const files=await window.openai.selectFiles();const selected=files?.[0];if(!selected)return;const filename=selected.fileName||selected.name,fileId=selected.fileId||selected.id,contentType=selected.mimeType||selected.type;if(!filename||!fileId||!contentType)throw new Error('The selected file is missing required metadata.');const source=await window.openai.getFileDownloadUrl({fileId});const bytes=await fetch(source).then(r=>r.blob());return{filename,contentType,bytes};}const input=$('local-image');input.value='';input.click();const file=await new Promise(resolve=>{input.onchange=()=>resolve(input.files?.[0]);});if(!file)return;return{filename:file.name,contentType:file.type,bytes:file};}$('add-image').onclick=async()=>{const alterId=$('image-alter').value;if(!alterId){$('notice').textContent='Choose a profile first.';return;}try{$('notice').textContent='Choose an image to store privately…';const selected=await chooseImage();if(!selected){$('notice').textContent='No image selected.';return;}if(!['image/jpeg','image/png','image/webp'].includes(selected.contentType))throw new Error('Choose a JPEG, PNG, or WebP image.');const prep=await tool('prepare_private_image_upload',{alterId,filename:selected.filename,contentType:selected.contentType});const meta=prep?._meta||prep?.meta||window.openai?.toolResponseMetadata;if(!meta?.uploadEndpoint||!meta?.uploadCapability)throw new Error('The private upload authorization was not returned.');const form=new FormData();form.append('image',selected.bytes,selected.filename);form.append('alterId',alterId);const response=await fetch(meta.uploadEndpoint,{method:'POST',headers:{Authorization:'Bearer '+meta.uploadCapability},body:form});if(!response.ok)throw new Error((await response.json()).error||'Image upload failed.');$('notice').textContent='Image stored privately.';await refresh();}catch(e){$('notice').textContent=e.message||'Unable to store image.';}};window.addEventListener('message',event=>{const m=event.data;if(m?.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);return;}if(m?.method==='ui/initialize')render(m.params?.toolResult);if(m?.method==='ui/notifications/tool-result')render(m.params?.result);});if(window.openai?.toolOutput)render(window.openai.toolOutput);
</script></body></html>`;
}

function companionWidgetV4() {
  return companionWidget()
    .replace('<div class="row"><button id="add-image">Select private image</button>', '<input id="local-image" type="file" accept="image/jpeg,image/png,image/webp" hidden><div class="row"><button id="add-image">Select private image</button>')
    .replace(":root{font:18px/1.5 system-ui,sans-serif;color:#101820;background:#fff}", ":root{color-scheme:dark;font:20px/1.5 system-ui,sans-serif;color:#f8fafc;background:#07111f}")
    .replace(".card{max-width:700px;border:3px solid #101820;padding:18px}", ".card{max-width:700px;border:3px solid #e2e8f0;background:#0b1626;padding:18px}")
    .replace(".notice{background:#eff6ff;border-left:6px solid #075985", ".notice{background:#102a43;border-left:6px solid #38bdf8")
    .replace(".entry{border-top:2px solid #101820", ".entry{border-top:2px solid #e2e8f0")
    .replace(".muted{color:#334155}", ".muted{color:#cbd5e1}")
    .replace("button,input,select{font:inherit;padding:9px;border:2px solid #101820}", "button,input,select{font:inherit;padding:10px;border:3px solid #e2e8f0;background:#0b1626;color:#f8fafc}")
    .replace("button{background:#075985;color:#fff", "button{background:#38bdf8;color:#04131c")
    .replace(".secondary{background:#fff;color:#101820}", ".secondary{background:#0b1626;color:#f8fafc}")
    .replace("<section><h3>Profiles</h3>", "<section aria-labelledby=\"current-heading\"><h3 id=\"current-heading\">Hosting and fronting</h3><div id=\"current-front\" class=\"notice\">Loading hosting and fronting…</div></section><section><h3>Profiles</h3>")
    .replace("$('notice').textContent='Authorized private state loaded. Drafts are not history until you confirm.';", "const presence=state.presence;const host=presence?.hosting;const episodes=presence?.fronting||[];$('current-front').innerHTML='<strong>Hosting:</strong> '+esc(host?.alterName||'Not recorded')+'<br><strong>Fronting:</strong> '+(episodes.map(p=>esc(p.alterName)).join(', ')||'No open episodes recorded.');$('notice').textContent='Authorized private state loaded. Drafts are not history until you confirm.';")
    .replace("window.addEventListener('message',event=>{const m=event.data;", "window.addEventListener('message',event=>{if(event.source!==window.parent)return;const m=event.data;")
    .replace("if(m?.method==='ui/initialize')render(m.params?.toolResult);if(m?.method==='ui/notifications/tool-result')render(m.params?.result);", "if(m?.method==='ui/notifications/tool-result')render(m.params?.structuredContent);");
}

function companionWidgetV5() {
  return companionWidgetV4()
    .replace('<head><meta charset="utf-8">', '<head><meta charset="utf-8"><meta name="referrer" content="no-referrer">')
    .replace(".secondary{background:#0b1626;color:#f8fafc}", ".secondary{background:#0b1626;color:#f8fafc}.gallery{display:grid;gap:18px}.gallery-group{border-top:2px solid #e2e8f0;padding-top:14px}.gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}.gallery-image{width:100%;min-height:180px;max-height:320px;object-fit:contain;background:#020617;border:3px solid #e2e8f0}")
    .replace("let n=1,state={profiles:[],assignments:[],todos:[]};", "let n=1,state={profiles:[],assignments:[],todos:[]},imageManifest=[];function privateImages(meta){for(const candidate of [meta,meta?._meta,meta?.result,meta?.mcp_tool_result,meta?.call_tool_result])if(Array.isArray(candidate?.privateImages))return candidate.privateImages;return null;}")
    .replace("function render(data){state=", "function render(data,meta){const images=privateImages(meta);if(images)imageManifest=images;state=")
    .replace("$('image-alter').innerHTML=", "$('gallery').innerHTML=ps.map(p=>{const images=imageManifest.filter(image=>image.alterId===p.id);return images.length?'<section class=\"gallery-group\"><h4>'+esc(p.name)+' — '+images.length+' private picture'+(images.length===1?'':'s')+'</h4><div class=\"gallery-grid\">'+images.map((image,index)=>'<img class=\"gallery-image\" src=\"'+esc(image.src)+'\" alt=\"Private picture '+(index+1)+' of '+esc(p.name)+'\" loading=\"lazy\">').join('')+'</div></section>':'';}).join('')||'No private pictures stored.';$('image-alter').innerHTML=")
    .replace("</section><section><h3>Open to-dos</h3>", "</section><section aria-labelledby=\"gallery-heading\"><h3 id=\"gallery-heading\">Private picture gallery</h3><div id=\"gallery\" class=\"gallery muted\">Loading private pictures…</div></section><section><h3>Open to-dos</h3>")
    .replace("async function refresh(){try{render(await tool('get_companion_state',{}));}", "async function refresh(){try{const result=await tool('get_companion_state',{});render(result,result?._meta||result?.meta||window.openai?.toolResponseMetadata);}")
    .replace("if(m?.method==='ui/notifications/tool-result')render(m.params?.structuredContent);", "if(m?.method==='ui/notifications/tool-result')render(m.params?.structuredContent,m.params?._meta||m.params?.meta||window.openai?.toolResponseMetadata);")
    .replace("if(window.openai?.toolOutput)render(window.openai.toolOutput);", "if(window.openai?.toolOutput)render(window.openai.toolOutput,window.openai.toolResponseMetadata);");
}

// Hosts follow tool results more reliably than descriptions, so the zero-Bunch-
// cost ChatGPT route travels with the reference IDs it explains.
function sceneRoutingHint(alters: Array<{ name: string; appearanceReferenceImageIds: string[]; archivedAt?: unknown }>) {
  const names = alters.filter((alter) => alter.appearanceReferenceImageIds.length && !alter.archivedAt).map((alter) => alter.name);
  if (!names.length) return "";
  const call = names.length <= 3 ? `call prepare_chatgpt_alter_image with alterNames ${JSON.stringify(names)}` : "call prepare_chatgpt_alter_image with the exact names of the people to draw";
  return ` Appearance reference IDs identify private photos and carry no pixels. In ChatGPT, to draw ${names.length === 1 ? names[0] : "them"}, ${call} and the requested scene; the sceneImage input is optional. Its widget transfers the saved references to ChatGPT as transient files and asks ChatGPT's image generator to run once. Do not call generate_scene from ChatGPT, ask for a re-upload, or draw from text alone.`;
}

// _meta remains widget-only. The ChatGPT handoff widget converts those private
// capabilities into transient ChatGPT files without using Bunch generation.
function withSceneRoute<T extends { structuredContent: { ready: boolean; identities: Array<{ alterName: string; referenceImageIds: string[] }> }; content: Array<{ type: "text"; text: string }> }>(prepared: T): T {
  const { ready, identities } = prepared.structuredContent;
  const names = identities.map((identity) => identity.alterName);
  if (!ready || !names.length || names.length > 12 || identities.some((identity) => !identity.referenceImageIds.length)) return prepared;
  const text = `To draw ${names.length === 1 ? names[0] : "these people"} in ChatGPT, call prepare_chatgpt_alter_image with alterNames ${JSON.stringify(names)} and the scene; omit sceneImage unless the user supplied one. Its widget uploads every saved appearance reference as a transient ChatGPT file and requests one ChatGPT image generation. Do not call generate_scene from ChatGPT, draw from this metadata-only packet, or ask the user to re-upload a reference Bunch already holds.`;
  return { ...prepared, content: [{ type: "text" as const, text }, ...prepared.content] } as T;
}

async function companionState(ownerId: string, service = getSystemService()) {
  const [currentFront, profiles, assignments, notes, todos, preferences] = await Promise.all([service.getCurrentFront(ownerId), service.listAlters(ownerId), repository.listAssignments(ownerId), service.listNotes(ownerId), service.listTodos(ownerId), repository.listPreferences(ownerId)]);
  return { presence: await service.getCurrentPresence(ownerId), currentFront, profiles: profiles.data, assignments, notes: notes.data, todos: todos.data, preferences };
}

async function companionWidgetMeta(ownerId: string, publicOrigin: string, profileRepository: Pick<SystemRepository, "listProfiles"> = repository, summaryOverride?: ConversationSummaryService) {
  const profiles = await profileRepository.listProfiles(ownerId);
  return {
    privateImages: profiles.flatMap((profile) => profile.images.map((image) => ({
      alterId: profile.id,
      isProfilePicture: image.isProfilePicture,
      src: `${publicOrigin}/api/system/images/inline/${image.id}?cap=${encodeURIComponent(issueImageReadCapability(ownerId, image.id))}`,
    }))),
  };
}

// Where this instance is actually served from. There is deliberately no fallback:
// a clone with no configuration must fail loudly rather than quietly issue upload
// endpoints and widget CSP entries pointing at somebody else's deployment.
function requiredPublicOrigin() {
  const origin = process.env.SYSTEM_PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (!origin) throw new Error("SYSTEM_PUBLIC_ORIGIN is not configured.");
  return origin;
}

export function createMcpServer(ownerId: string, serviceOverride?: ReturnType<typeof getSystemService>, catchUpOverride?: ReturnType<typeof getCatchUpService>, profileRepository: Pick<SystemRepository, "listProfiles"> = repository, summaryOverride?: ConversationSummaryService, scheduleNativeScene?: (ownerId: string, renderId: string) => void, nativeSceneServiceOverride?: Pick<NativeSceneService, "start" | "get" | "list"> & Partial<Pick<NativeSceneService, "allowance">>, loadAccount?: (ownerId: string) => Promise<{ display_name: string } | null>, imageDeletionOverride?: Pick<ImageDeletionService, "delete">) {
  const server = new McpServer({ name: "Working Monkeys", version: "0.7.0" }, { instructions: "Use Working Monkeys only for owner-authorized private records. Use get_current_presence to distinguish hosting responsibility from overlapping fronting episodes. Record hosting with set_system_host and independently start/end fronting episodes only after explicit user statements. Never infer an end or absence. Use a selected periodId for saved-record catch-up. An explicit self-identification may offer conversation catch-up but never authorizes a front switch. After a confirmed arrival, automatically prepare conversation catch-up and summarize available messages in ChatGPT without another catch-up confirmation. Follow the mutation result instructions to select the exact arrival; do not repeat a summary on a replay. For a separate explicit catch-up request, resolve the named profile with list_alters, call prepare_conversation_catch_up, and use only host capabilities actually available to read messages in the requested window. Report topics, decisions, open matters, source links, and coverage gaps. System does not automatically receive ChatGPT history: if the host lacks access, say that Working Monkeys supplied dates but the host cannot retrieve other conversations, then offer selected conversations or a capable host. For a fronting episode, retrieve its catch-up session and every get_episode_records page, read get_episode_review for the current revision, then save_episode_review_v1. Distinguish Bunch records from available memory and conversation context, and label missing coverage or an unknown prior end. For legacy or separately selected windows, call save_conversation_catch_up with the exact dates, summary, and coverage gaps. Save it for 30 days using one requestId reused on retries. Never persist raw transcripts. Retrieve prior summaries with list_conversation_catch_ups/get_conversation_catch_up; do not treat a saved summary as new source evidence. For notes, preserve the approved body and record an actor only when named. For the profile lineup or selected profile pictures, use render_alter_lineup. The catch-up widget shows saved records only, and its review actions never complete underlying tasks. For saving an important thread, use suggest_important_thread only with the user-approved link, summary, key decision or action, flagger, and recipients. Then use confirm_important_thread only after the user explicitly approves that specific suggestion. Never save raw transcripts. For photos, use the authenticated private gallery or the existing private upload workflow so bytes transfer directly to private storage; never expose image bytes or storage keys to the model. For every explicit ChatGPT image request with named alters, call prepare_chatgpt_alter_image with exact names; its sceneImage input is optional. The widget transfers selected references as transient ChatGPT files and asks ChatGPT image generation to run once without a Bunch provider call or allowance charge. Never call generate_scene as a ChatGPT fallback. Use generate_scene only on a Bunch-owned surface or when the user explicitly requests paid Bunch-native generation. Never draw a named alter from text or reference IDs alone, never omit an unknown, ambiguous, archived, or reference-less alter, and never ask the user to upload a photo Bunch already holds. The relevant widget performs the private handoff or follows the native scene job. If the host cannot render the companion widget, use open_private_photo_gallery to give the user the authenticated browser fallback instead." });
  // Every tool call funnels through this wrapper, so invocation counts cover
  // reads and writes alike (activity_event only ever logged mutations). The
  // cast preserves registerTool's generic signature for every call site below.
  type RegisterTool = typeof server.registerTool;
  const usage = getMcpUsageService();
  const rawRegisterTool: RegisterTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, cb: (...cbArgs: unknown[]) => unknown) => rawRegisterTool(name, config as never, (async (...cbArgs: unknown[]) => {
    const startedAt = Date.now();
    try {
      const result = await cb(...cbArgs);
      await usage.record(ownerId, name, Date.now() - startedAt, Boolean((result as { isError?: boolean } | undefined)?.isError));
      return result;
    } catch (error) {
      await usage.record(ownerId, name, Date.now() - startedAt, true);
      throw error;
    }
  }) as never)) as RegisterTool;
  registerSystemSkill(server);
  registerDemoSystemTool(server);
  server.registerTool("connect_private_system", connectPrivateSystemTool, async () => ({
    structuredContent: { mode: "private", authenticated: true },
    content: [{ type: "text", text: "Connected to your private Bunch system. Use the already-advertised private actions for your own records. Demo system remains available only when explicitly requested." }],
  }));
  server.registerTool(ACCOUNT_PROFILE_TOOL_NAME, accountProfileTool, async () => {
    const account = await (loadAccount ?? ((id: string) => getPilotService().account(id)))(ownerId);
    const profile = account?.display_name.trim()
      ? { id: accountProfileId(ownerId), name: account.display_name.trim() }
      : { id: accountProfileId(ownerId) };
    return { structuredContent: profile, content: [{ type: "text", text: JSON.stringify(profile) }] };
  });
  const publicOrigin = requiredPublicOrigin();
  const widgetMeta = { ui: { domain: publicOrigin, csp: { connectDomains: [publicOrigin], resourceDomains: [publicOrigin] }, prefersBorder: true }, "openai/widgetDescription": "Bunch catch-up with clear review actions and accessible record filters.", "openai/widgetCSP": { connect_domains: [publicOrigin], resource_domains: [publicOrigin] }, "openai/widgetDomain": publicOrigin };
  server.registerResource("system-companion", WIDGET_URI, { mimeType: "text/html;profile=mcp-app", _meta: widgetMeta }, async () => ({ contents: [{ uri: WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: catchUpWidget(publicOrigin), _meta: widgetMeta }] }));
  const lineupMeta = { ...widgetMeta, "openai/widgetDescription": "Bunch profile lineup with selected private profile pictures." };
  server.registerResource("system-alter-lineup", LINEUP_WIDGET_URI, { mimeType: "text/html;profile=mcp-app", _meta: lineupMeta }, async () => ({ contents: [{ uri: LINEUP_WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: lineupWidget(publicOrigin), _meta: lineupMeta }] }));
  const sceneMeta = { ...widgetMeta, "openai/widgetDescription": "A private Bunch scene that updates in place and shows the finished image." };
  server.registerResource("system-native-scene", SCENE_WIDGET_URI, { mimeType: "text/html;profile=mcp-app", _meta: sceneMeta }, async () => ({ contents: [{ uri: SCENE_WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: sceneWidget(publicOrigin), _meta: sceneMeta }] }));
  const chatgptAlterImageMeta = { ...widgetMeta, "openai/widgetDescription": "A private Bunch reference handoff that prepares named alters for ChatGPT image generation, with or without an additional scene image, without exposing private reference URLs to the model." };
  server.registerResource("system-chatgpt-alter-image", CHATGPT_ALTER_IMAGE_WIDGET_URI, { mimeType: "text/html;profile=mcp-app", _meta: chatgptAlterImageMeta }, async () => ({ contents: [{ uri: CHATGPT_ALTER_IMAGE_WIDGET_URI, mimeType: "text/html;profile=mcp-app", text: chatgptAlterImageWidget(publicOrigin), _meta: chatgptAlterImageMeta }] }));
  // Preserve previously advertised catch-up and lineup descriptors as well as
  // the older companion resources, whose payload uses the original shape.
  for (const [index, uri] of LEGACY_CATCH_UP_WIDGET_URIS.entries()) {
    const version = index + 11;
    server.registerResource(`system-catch-up-legacy-${version}`, uri, { mimeType: "text/html;profile=mcp-app", _meta: widgetMeta }, async () => ({ contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: catchUpWidget(publicOrigin), _meta: widgetMeta }] }));
  }
  for (const [index, previousLineupUri] of LEGACY_LINEUP_WIDGET_URIS.entries()) {
    const version = index + 1;
    server.registerResource(`system-alter-lineup-legacy-${version}`, previousLineupUri, { mimeType: "text/html;profile=mcp-app", _meta: lineupMeta }, async () => ({ contents: [{ uri: previousLineupUri, mimeType: "text/html;profile=mcp-app", text: lineupWidget(publicOrigin), _meta: lineupMeta }] }));
  }
  for (const [index, uri] of LEGACY_CHATGPT_ALTER_IMAGE_WIDGET_URIS.entries()) {
    server.registerResource(`system-chatgpt-alter-image-legacy-${index + 1}`, uri, { mimeType: "text/html;profile=mcp-app", _meta: chatgptAlterImageMeta }, async () => ({ contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: chatgptAlterImageWidget(publicOrigin), _meta: chatgptAlterImageMeta }] }));
  }
  for (const [index, uri] of LEGACY_WIDGET_URIS.entries()) {
    server.registerResource(`system-companion-legacy-${index + 1}`, uri, { mimeType: "text/html;profile=mcp-app", _meta: widgetMeta }, async () => ({ contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: companionWidgetV5(), _meta: widgetMeta }] }));
  }

  server.registerTool("get_companion_state", { title: "Get private companion state", description: "Use this when the user wants to review their System records in ChatGPT. It returns the current front plus authorized profiles, notes, to-dos, preferences, and coverage records, but never image bytes, private image URLs, storage keys, or raw chat transcripts.", inputSchema: {}, outputSchema: companionStateSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }, async () => ({ structuredContent: await companionState(ownerId, serviceOverride ?? getSystemService()), content: [{ type: "text", text: "Loaded your authorized private companion records." }], _meta: await companionWidgetMeta(ownerId, publicOrigin) }));
  server.registerTool("render_system_companion", { title: "Open Bunch catch-up", description: "Open the private saved-record catch-up for a selected hosting or fronting periodId. Defaults to the latest current fronter; the widget offers other current fronting episodes. Review actions only affect this catch-up; use render_alter_lineup for profile pictures and prepare_conversation_catch_up for a host conversation-history handoff.", inputSchema: { periodId: uuidSchema.optional() }, outputSchema: { catchUp: catchUpSessionSchema.nullable(), presence: currentPresenceResponseSchema.shape.data }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }, _meta: { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI } }, async ({periodId}) => ({ structuredContent: { presence: await (serviceOverride ?? getSystemService()).getCurrentPresence(ownerId), catchUp: await (periodId ? (catchUpOverride ?? getCatchUpService()).openForPresence(ownerId, periodId) : (catchUpOverride ?? getCatchUpService()).openForCurrentFronter(ownerId)) }, content: [{ type: "text", text: "Opened your private Bunch catch-up." }] }));
  server.registerTool("open_private_photo_gallery", { title: "Open private photo gallery", description: "Use this when the user wants to view private profile photos but the current host cannot render the System companion widget. It returns a permanent authenticated browser route, never image bytes or temporary image links.", inputSchema: {}, outputSchema: privateGalleryOutputSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }, async () => {
    const url = `${publicOrigin}/gallery`;
    return { structuredContent: { url }, content: [{ type: "text", text: `Open your authenticated private photo gallery: ${url}` }] };
  });

  // Catalog discovery registers handlers but does not execute them. Keep the
  // database-backed service lazy so an anonymous tools/list can advertise the
  // private actions without opening private storage.
  const service = serviceOverride ?? new Proxy({} as ReturnType<typeof getSystemService>, {
    get(_target, property) {
      const current = getSystemService();
      const value = Reflect.get(current, property, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
  async function allActiveProfiles() {
    const profiles: z.infer<typeof alterViewSchema>[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.listAlters(ownerId, { limit: 100, cursor });
      profiles.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return profiles;
  }
  const catchUp = () => catchUpOverride ?? getCatchUpService();
  server.registerTool("render_alter_lineup", { title: "Show alter lineup", description: "Use this when the user asks to see the alter lineup, every alter, profile cards, avatars, or profile pictures. It renders every active authorized alter with the selected profile picture when one exists.", inputSchema: {}, outputSchema: lineupStateSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true }, _meta: { ui: { resourceUri: LINEUP_WIDGET_URI }, "openai/outputTemplate": LINEUP_WIDGET_URI, "openai/toolInvocation/invoking": "Loading alter lineup…", "openai/toolInvocation/invoked": "Lineup data ready." } }, async () => { const [currentFront, profiles] = await Promise.all([service.getCurrentFront(ownerId), allActiveProfiles()]); return { structuredContent: { presence: await service.getCurrentPresence(ownerId), currentFront, profiles }, content: [{ type: "text", text: `Prepared ${profiles.length} active alter profile${profiles.length === 1 ? "" : "s"} for the private lineup. Display is not confirmed; do not claim pictures are visible without checking the rendered widget.` }], _meta: await companionWidgetMeta(ownerId, publicOrigin, profileRepository) }; });
  server.registerTool("get_catch_up", { title: "Get current catch-up", description: "Read get_current_presence and choose a hosting or fronting periodId. An omitted ID uses the most recently arrived current fronter. Explicit hosting period IDs remain supported for compatibility. The backend uses prior ended periods of the same kind for this alter, not inferred absence, and includes direct notes, assigned or System-wide todos, decisions, confirmed important threads, and urgent carryover.", inputSchema: { periodId: uuidSchema.optional() }, outputSchema: { data: catchUpSessionSchema.nullable(), meta: responseMetaSchema }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({periodId}) => ({ structuredContent: { data: await (periodId ? catchUp().openForPresence(ownerId, periodId) : catchUp().openForCurrentFronter(ownerId)), meta: {} }, content: [{ type: "text", text: "Loaded the current catch-up." }] }));
  server.registerTool("set_catch_up_item_state", { title: "Review catch-up item", description: "Mark a catch-up item reviewed or postpone its review. Existing resolved review states remain supported. This changes only its review state and never closes or edits the underlying note, todo, decision, or thread.", inputSchema: { entryId: uuidSchema, ...setCatchUpItemStateSchema.shape }, outputSchema: { data: catchUpSessionSchema, meta: responseMetaSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ entryId, ...input }) => { const result = await catchUp().setItemState(ownerId, entryId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: `Marked the catch-up item ${input.state.toLowerCase()}. The underlying record is unchanged.` }] }; });
  server.registerTool("suggest_important_thread", { title: "Suggest important thread", description: "Offer a thread for the user's review at an explicit decision or action moment. Save only the proposed link, approved-summary draft, key decision or action, flagger, and recipients; never save a transcript. The suggestion does not enter catch-up until confirmed.", inputSchema: importantThreadCreateSchema.shape, outputSchema: { data: importantThreadSuggestionViewSchema, meta: responseMetaSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const result = await catchUp().suggestThread(ownerId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Created a thread suggestion for human confirmation. It is not in catch-up yet." }] }; });
  server.registerTool("confirm_important_thread", { title: "Confirm important thread", description: "Confirm a specific thread suggestion after the user approves its title, summary, key decision or action, flagger, and recipients.", inputSchema: { threadId: uuidSchema, expectedVersion: z.number().int().positive(), requestId: uuidSchema }, outputSchema: { data: importantThreadConfirmationViewSchema, meta: responseMetaSchema }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ threadId, expectedVersion, requestId }) => { const result = await catchUp().confirmThread(ownerId, threadId, expectedVersion, requestId, "MCP"); return { structuredContent: { data: result.data, meta: { requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Confirmed the important thread. It can appear in the next eligible catch-up." }] }; });
  const summaries = () => summaryOverride ?? new ConversationSummaryService();
  server.registerTool("save_episode_review_v1", {
    title: "Save fronting return review", description: "Save a user-reviewed, host-composed review for an exact fronting catch-up session. Do not call this until the user has reviewed the brief and explicitly authorizes the write. Read get_episode_review first for expectedRevision. Use Overview, attention now, and significant changes; distinguish Bunch references from available memory/context and describe missing coverage. No model API call occurs. Reuse requestId on retries. Content expires after 30 days; saving never changes presence or source records.",
    inputSchema: saveEpisodeReviewSchema.shape, outputSchema: { id: uuidSchema, expiresAt: z.string().datetime(), revision: z.number().int(), catchUpSessionId: uuidSchema, alterId: uuidSchema, replayed: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => { const result = await summaries().saveEpisodeReview(ownerId,input); return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }; });
  server.registerTool("get_episode_records", {
    title: "Read return interval records", description: "Read a page of records from an exact catch-up session without shortening its return window. Follow nextCursor with after until null; unresolved carryover remains included. Unknown prior end is a coverage gap, not an invented duration.",
    inputSchema: { catchUpSessionId: uuidSchema, after: uuidSchema.optional(), limit: z.number().int().min(1).max(100).default(50) },
    outputSchema: { ...catchUpSessionSchema.shape, nextCursor: uuidSchema.nullable(), coverage: z.string() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({catchUpSessionId,after,limit}) => { const result = await catchUp().readEpisodeRecords(ownerId,catchUpSessionId,after,limit); return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }; });
  server.registerTool("get_episode_review", {
    title: "Read fronting return review", description: "Read the saved review and revision for an exact catch-up session. Null review means none is available, including expiry; use the returned revision when saving.", inputSchema: { catchUpSessionId: uuidSchema }, outputSchema: { revision: z.number().int(), review: conversationSummarySchema.nullable() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({catchUpSessionId}) => { const result = await summaries().forSession(ownerId,catchUpSessionId); return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] }; });
  server.registerTool("save_conversation_catch_up", { title: "Save catch-up for 30 days", description: "Save the user-reviewed, host-generated synthesis after catch-up, with its exact window and explicit coverage gaps. Do not call this until the user explicitly authorizes the write. Never supply raw transcripts. Reuse requestId on retries; retention starts on first save and never renews. The response reports the original expiry even if a replayed summary has expired or been deleted.", inputSchema: saveConversationSummarySchema.shape, outputSchema: { id: uuidSchema, expiresAt: z.string().datetime(), replayed: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => {
    const result = await summaries().save(ownerId,input);
    return { structuredContent: result, content: [{ type: "text", text: `Catch-up save recorded; expires ${result.expiresAt}. ${result.replayed ? "Replay; retention was not extended. Use get_conversation_catch_up to check availability." : "Saved privately for 30 days."}` }] };
  });
  server.registerTool("list_conversation_catch_ups", { title: "List saved catch-ups", description: "Read this account's unexpired catch-up summaries, newest first. Optional alterId and before timestamp filter; returns at most 50. Saved summaries are historical syntheses, not current facts or new source messages.", inputSchema: listConversationSummariesSchema.shape, outputSchema: { summaries: z.array(conversationSummarySchema) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async input => {
    const result = await summaries().list(ownerId,input);
    return { structuredContent: { summaries: result }, content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  server.registerTool("get_conversation_catch_up", { title: "Read saved catch-up", description: "Retrieve an unexpired summary belonging to this account by ID.", inputSchema: { id: uuidSchema }, outputSchema: conversationSummarySchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({id}) => {
    const result = await summaries().get(ownerId,id);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  server.registerTool("delete_conversation_catch_up", { title: "Delete saved catch-up", description: "Delete a summary early when the user requests it. Retrying the original save cannot recreate it.", inputSchema: { id: uuidSchema }, outputSchema: { deleted: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({id}) => {
    await summaries().remove(ownerId,id);
    return { structuredContent: { deleted: true }, content: [{ type: "text", text: "Summary removed if it belonged to this account." }] };
  });
  server.registerTool("prepare_conversation_catch_up", { title: "Prepare conversation catch-up", description: "Use automatically after a confirmed arrival, or when the user explicitly asks for a conversation catch-up. Resolve the named profile with list_alters first and proceed only with one exact active match. This read-only handoff returns user-selected dates or a candidate based on the selected periodId and prior period of the same kind. A FRONTING candidate is explicitly RECORDED_FRONTING_WINDOW; it never proves absence. This tool never changes fronting, reads ChatGPT history, generates, or saves a summary. Draft first; save only after the user reviews and authorizes it.", inputSchema: prepareConversationCatchUpSchema.shape, outputSchema: conversationCatchUpHandoffSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const catchUp = catchUpOverride ?? (ownerId.startsWith("demo:") ? new CatchUpService({} as never) : getCatchUpService()); const data = await catchUp.prepareConversationCatchUp(ownerId, input); return { structuredContent: data, content: [{ type: "text", text: data.status === "READY" ? "Prepared a conversation catch-up handoff for a host with history access." : "Choose a start and end time for this conversation catch-up." }] }; });
  server.registerTool("get_system_host", {
    title: "Get System host", description: "Read the explicitly recorded System host. Hosting means responsibility for everything otherwise unclaimed during that period. Read get_current_presence for its recorded period and independent fronting episodes. Missing or cleared host means Not recorded; never infer it.",
    inputSchema: {}, outputSchema: systemHostResponseSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const data = await service.getSystemHost(ownerId);
    return { structuredContent: { data, meta: {} }, content: [{ type: "text", text: data?.alterName ? `${data.alterName} is the recorded System host.` : "System host: Not recorded." }] };
  });
  server.registerTool("set_system_host", {
    title: "Set System host", description: "Set or clear the System host only after the user explicitly identifies that role. Read get_system_host first and pass its version, or null if never recorded. alterId null explicitly clears the role. Hosting means responsibility for everything otherwise unclaimed throughout the period. Setting a different host ends the prior hosting period and opens a new one now; clearing closes hosting. This never ends fronting episodes or rewrites legacy front records or coverage. Use requestId for safe retries.",
    inputSchema: setSystemHostSchema.shape, outputSchema: systemHostResponseSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const result = await service.setSystemHost(ownerId, input, "MCP");
    return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: result.data.alterName ? `Recorded ${result.data.alterName} as System host. ${result.replayed ? "This is a replay; do not generate a duplicate summary." : `Read get_current_presence. Only if hosting.alterId is ${result.data.alterId} and hosting.startedAt equals ${result.data.recordedAt}, call prepare_conversation_catch_up with that hosting periodId and alterId. A reaffirmed host or a later arrival must not trigger a new summary. Use the known IANA time zone, or UTC if unknown. Generate the returned conversation catch-up in ChatGPT now. For fronting episodes, read get_episode_review and save_episode_review_v1 against the returned catch-up session. State coverage gaps when memory is unavailable.`}` : "Cleared the System host record." }] };
  });
  server.registerTool("get_current_presence", {
    title: "Get hosting and fronting", description: "Read the recorded active hosting period and all active fronting episodes separately. Hosting means responsibility for everything otherwise unclaimed throughout the period. Fronting episodes can overlap a host and each other and end independently. legacyCurrentFront is an unclassified compatibility record, not proof of either kind. No end is inferred from hours or days.",
    inputSchema: {}, outputSchema: currentPresenceResponseSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const result = { data: await service.getCurrentPresence(ownerId), meta: {} };
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  server.registerTool("start_fronting_episode", {
    title: "Start fronting episode", description: "Use only when the user explicitly says an alter is now fronting. Search with list_alters and proceed only after one exact active profile match is verified. Read get_current_presence first. Starts this alter's episode now without replacing the host or ending anyone else's episode. Use set_system_host for hosting responsibility instead. After success, prepare a catch-up draft for this exact episode; never save it until the user reviews and explicitly authorizes the write. No automatic expiry is inferred. Reuse requestId only for retries.",
    inputSchema: startFrontingEpisodeSchema.shape, outputSchema: { ...presencePeriodResponseSchema.shape, catchUp: catchUpSessionSchema.nullable(), catchUpStatus: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const result = await service.startFrontingEpisode(ownerId, input, "MCP");
    let arrivalCatchUp = null;
    let catchUpStatus = "AVAILABLE";
    try { arrivalCatchUp = await catchUp().openForEpisode(ownerId, result.data.id); catchUpStatus = arrivalCatchUp ? (arrivalCatchUp.windowStart ? "RECORDED_WINDOW" : "BOUNDARY_UNKNOWN") : "NO_SESSION"; }
    catch { catchUpStatus = "RETRY_GET_CATCH_UP"; }

    return { structuredContent: { data: result.data, catchUp: arrivalCatchUp, catchUpStatus, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: `Recorded the fronting episode; hosting and other episodes continue unchanged. ${result.replayed ? "This is a replay; do not generate a duplicate summary." : `Call prepare_conversation_catch_up now with alterId ${result.data.alterId}, periodId ${result.data.id}, and the known IANA time zone (UTC if unknown). Draft a brief, source-linked catch-up from available messages. Show it to the user with coverage gaps, then call save_episode_review_v1 only after explicit approval. State coverage gaps when memory is unavailable.`}` }] };
  });
  server.registerTool("end_fronting_episode", {
    title: "End fronting episode", description: "Use only for an explicitly reported end of a fronting episode. Read get_current_presence first and pass the exact episodeId and version. Ends only that episode now; hosting and other episodes are unchanged. Do not infer an end from elapsed time, silence, or a host change. Reuse requestId for retries.",
    inputSchema: endFrontingEpisodeSchema.shape, outputSchema: presencePeriodResponseSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const result = await service.endFrontingEpisode(ownerId, input, "MCP");
    return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Recorded the end of this fronting episode." }] };
  });
  server.registerTool("list_fronting_history", {
    title: "Who was out when",
    description: "Read hosting periods, fronting episodes, and separately labeled LEGACY_FRONT records when asked who was out when, who was fronting during a date range, or when a named alter was last out. Resolve names with list_alters and pass alterId if needed. from/to select overlapping sessions (inclusive start, exclusive end); convert local dates using the user's timezone, asking if unknown. Results are newest first and retain original session timestamps. Follow nextCursor as before for more records. kind distinguishes HOSTING responsibility periods, overlapping FRONTING episodes, and unclassified LEGACY_FRONT records; never relabel legacy records. origin SYSTEM_HOST_SNAPSHOT means the start is only the previously recorded host timestamp. An omitted endedAt means no end is recorded for that kind. These are confirmed records, not proof of anyone's absence or a complete account of unrecorded time.",
    inputSchema: frontingHistoryQuerySchema.shape,
    outputSchema: frontingHistoryResponseSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const result = await service.listFrontingHistory(ownerId, input);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  });
  server.registerTool("get_current_front", { title: "Get current front", description: "Legacy compatibility read. Use get_current_presence for hosting and overlapping fronting episodes. It returns only the user-confirmed timestamped current front, or null when none is recorded.", inputSchema: {}, outputSchema: currentFrontResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => { const current = await service.getCurrentFront(ownerId); return { structuredContent: { data: current, meta: {} }, content: [{ type: "text", text: current ? `${current.alterName} is the recorded current front.` : "No current front is recorded." }] }; });
  server.registerTool("switch_current_front", { title: "Switch current front", description: "Legacy exclusive-switch compatibility only. Use start_fronting_episode for new fronting episodes and set_system_host for hosting. Read get_current_front first, pass its version (or null when empty), and use a requestId so retries return the original handoff.", inputSchema: frontingSwitchSchema.shape, outputSchema: switchFrontResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const result = await service.switchCurrentFront(ownerId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: `${result.data.current.alterName} is now the recorded current front. ${result.replayed ? "This is a replay; do not generate a duplicate summary." : `Call prepare_conversation_catch_up now with alterId ${result.data.current.alterId}, frontingSessionId ${result.data.current.id}, and the known IANA time zone (UTC if unknown). Draft the returned conversation catch-up in ChatGPT, show it with sources and coverage gaps, then save only after explicit user approval.`}` }] }; });
  server.registerTool("list_system_notes", { title: "List private notes", description: "Use this when the user wants to read private System notes, optionally filtered by linked alter or explicitly recorded author. Use cursor pagination for additional results.", inputSchema: listNotesSchema.shape, outputSchema: noteListResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const page = await service.listNotes(ownerId, input); return { structuredContent: { data: page.data, meta: { nextCursor: page.nextCursor } }, content: [{ type: "text", text: `Found ${page.data.length} private note(s).` }] }; });
  server.registerTool("create_system_note", { title: "Create private note", description: "Use this only when the user explicitly asks to leave a private System note. Preserve the approved body; link alterId to the note's subject or recipient, and set actorAlterId only when the user explicitly identifies the author. requestId makes retries safe.", inputSchema: noteCreateSchema.shape, outputSchema: noteResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const result = await service.createNote(ownerId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: result.replayed ? "Returned the original private note result." : "Created the private System note." }] }; });
  server.registerTool("get_system_note", { title: "Get private note", description: "Read one owner-authorized private note and its linked tasks.", inputSchema: { noteId: uuidSchema }, outputSchema: noteResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ noteId }) => ({ structuredContent: { data: await service.getNote(ownerId, noteId), meta: {} }, content: [{ type: "text", text: "Loaded the private note." }] }));
  server.registerTool("update_system_note", { title: "Update private note", description: "Update a note body or its linked tasks using the version last read. Note recipients, authorship, and image gifts are preserved.", inputSchema: { noteId: uuidSchema, ...notePatchSchema.shape }, outputSchema: noteResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ noteId, ...input }) => { const result = await service.updateNote(ownerId, noteId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Updated the private note." }] }; });
  server.registerTool("erase_system_note", { title: "Erase private note", description: "Permanently erase one private note after explicit confirmation. Linked task references are removed; tasks remain.", inputSchema: { noteId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: z.object({ data: z.object({ id: uuidSchema, erased: z.literal(true), removedTaskReferences: z.number().int().nonnegative() }), meta: responseMetaSchema }).shape, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ noteId, ...input }) => { const result = await service.eraseNote(ownerId, noteId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Erased the private note and its task references." }] }; });
  server.registerTool("list_alters", { title: "List alters", description: "Find authorized alters by name or alias. Use cursor pagination for additional results.", inputSchema: listAltersSchema.shape, outputSchema: alterListResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const page = await service.listAlters(ownerId, input); return { structuredContent: { data: page.data, meta: { nextCursor: page.nextCursor } }, content: [{ type: "text", text: `Found ${page.data.length} alter record(s).${sceneRoutingHint(page.data)}` }] }; });
  server.registerTool("get_alter", { title: "Get alter", description: "Get one authorized alter by its stable UUID. appearanceReferenceImageIds identify private photos but carry no image content. In ChatGPT, draw this alter with prepare_chatgpt_alter_image and the exact name; sceneImage is optional.", inputSchema: { alterId: uuidSchema, includeArchived: z.boolean().default(false) }, outputSchema: alterResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ alterId, includeArchived }) => { const data = await service.getAlter(ownerId, alterId, includeArchived); return { structuredContent: { data, meta: {} }, content: [{ type: "text", text: `Loaded the alter record.${sceneRoutingHint([data])}` }] }; });
  server.registerTool("create_alter", { title: "Create alter", description: "Create a private alter profile after the user explicitly asks. requestId makes retries safe.", inputSchema: alterCreateSchema.shape, outputSchema: alterResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const result = await service.createAlter(ownerId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: result.replayed ? "Returned the original alter creation result." : "Created the private alter profile." }] }; });
  server.registerTool("update_alter", { title: "Update alter", description: "Update specified alter fields using the version last read. A stale version returns CONFLICT.", inputSchema: { alterId: uuidSchema, ...alterPatchSchema.shape }, outputSchema: alterResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ alterId, ...input }) => { const result = await service.updateAlter(ownerId, alterId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Updated the alter profile." }] }; });
  server.registerTool("archive_alter", { title: "Archive alter", description: "Archive an alter without permanently erasing it.", inputSchema: { alterId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: alterResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ alterId, ...input }) => { const result = await service.archiveAlter(ownerId, alterId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Archived the alter profile." }] }; });
  server.registerTool("restore_alter", { title: "Restore alter", description: "Restore an archived alter.", inputSchema: { alterId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: alterResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ alterId, ...input }) => { const result = await service.restoreAlter(ownerId, alterId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Restored the alter profile." }] }; });
  const previewResponse = z.object({ data: z.object({ alterId: uuidSchema, version: z.number().int(), blockers: z.object({ host: z.number().int(), todos: z.number().int(), notes: z.number().int(), coverage: z.number().int(), images: z.number().int() }), canErase: z.boolean(), previewToken: z.string().optional(), expiresAt: z.string().datetime().optional() }), meta: responseMetaSchema });
  server.registerTool("preview_erase_alter", { title: "Preview alter erasure", description: "Check permanent-erasure blockers and, only when clear, return a fresh short-lived erasure token.", inputSchema: { alterId: uuidSchema }, outputSchema: previewResponse.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ alterId }) => ({ structuredContent: { data: await service.previewEraseAlter(ownerId, alterId), meta: {} }, content: [{ type: "text", text: "Checked alter erasure blockers." }] }));
  const erasedResponse = z.object({ data: z.object({ id: uuidSchema, erased: z.literal(true) }), meta: responseMetaSchema });
  server.registerTool("erase_alter", { title: "Permanently erase alter", description: "Permanently erase an alter only with a fresh blocker-free preview token. This also erases its private Blob objects.", inputSchema: { alterId: uuidSchema, ...eraseAlterSchema.shape }, outputSchema: erasedResponse.shape, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ alterId, ...input }) => { const result = await service.eraseAlter(ownerId, alterId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Permanently erased the alter and its private images." }] }; });

  server.registerTool("list_todos", { title: "List todos", description: "List authorized todos filtered by status, assignee, due-date range, priority, or coverage.", inputSchema: listTodosSchema.shape, outputSchema: todoListResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const page = await service.listTodos(ownerId, input); return { structuredContent: { data: page.data, meta: { nextCursor: page.nextCursor } }, content: [{ type: "text", text: `Found ${page.data.length} todo record(s).` }] }; });
  server.registerTool("get_todo", { title: "Get todo", description: "Get one authorized todo by its stable UUID.", inputSchema: { todoId: uuidSchema, includeArchived: z.boolean().default(false) }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ todoId, includeArchived }) => ({ structuredContent: { data: await service.getTodo(ownerId, todoId, includeArchived), meta: {} }, content: [{ type: "text", text: "Loaded the todo." }] }));
  server.registerTool("create_todo", { title: "Create todo", description: "Create a System-wide or alter-assigned todo after the user explicitly asks. requestId makes retries safe.", inputSchema: todoCreateSchema.shape, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => { const result = await service.createTodo(ownerId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Created the private todo." }] }; });
  server.registerTool("update_todo", { title: "Update todo", description: "Update specified todo fields or assignees using the version last read.", inputSchema: { todoId: uuidSchema, ...todoPatchSchema.shape }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ todoId, ...input }) => { const result = await service.updateTodo(ownerId, todoId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Updated the todo." }] }; });
  server.registerTool("add_todo_checklist_item", { title: "Add task checklist item", description: "Add an ordered checklist item without changing task completion status.", inputSchema: { todoId: uuidSchema, ...checklistCreateSchema.shape }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ todoId, ...input }) => { const result = await service.createChecklistItem(ownerId, todoId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Added the checklist item." }] }; });
  server.registerTool("update_todo_checklist_item", { title: "Update task checklist item", description: "Edit, complete, or reorder a checklist item without automatically completing its task.", inputSchema: { todoId: uuidSchema, itemId: uuidSchema, ...checklistPatchSchema.shape }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ todoId, itemId, ...input }) => { const result = await service.updateChecklistItem(ownerId, todoId, itemId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Updated the checklist item." }] }; });
  server.registerTool("erase_todo_checklist_item", { title: "Erase task checklist item", description: "Remove a checklist item while preserving its parent task.", inputSchema: { todoId: uuidSchema, itemId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ todoId, itemId, ...input }) => { const result = await service.eraseChecklistItem(ownerId, todoId, itemId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Removed the checklist item." }] }; });
  server.registerTool("archive_todo", { title: "Archive todo", description: "Archive a todo without permanently erasing it.", inputSchema: { todoId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ todoId, ...input }) => { const result = await service.archiveTodo(ownerId, todoId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Archived the todo." }] }; });
  server.registerTool("restore_todo", { title: "Restore todo", description: "Restore an archived todo.", inputSchema: { todoId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: todoResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ todoId, ...input }) => { const result = await service.restoreTodo(ownerId, todoId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Restored the todo." }] }; });
  server.registerTool("erase_todo", { title: "Permanently erase todo", description: "Permanently erase a todo using its current version.", inputSchema: { todoId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: erasedResponse.shape, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ todoId, ...input }) => { const result = await service.eraseTodo(ownerId, todoId, input, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Permanently erased the todo." }] }; });

  const noteLinkResponse = z.object({ data: z.object({ id: uuidSchema, alterId: uuidSchema.optional(), version: z.number().int(), updatedAt: z.string().datetime() }), meta: responseMetaSchema });
  server.registerTool("set_note_alter", { title: "Set note alter", description: "Assign or unassign an alter on a note to resolve an erasure blocker.", inputSchema: { noteId: uuidSchema, alterId: uuidSchema.nullable(), ...versionMutationSchema.shape }, outputSchema: noteLinkResponse.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ noteId, alterId, ...input }) => { const result = await service.setNoteAlter(ownerId, noteId, alterId, input.expectedVersion, input.requestId, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Updated the note's alter link." }] }; });
  const coverageLinkResponse = z.object({ data: z.object({ id: uuidSchema, alterId: uuidSchema, version: z.number().int() }), meta: responseMetaSchema });
  server.registerTool("reassign_coverage", { title: "Reassign coverage", description: "Move a coverage record to another owned alter to resolve an erasure blocker.", inputSchema: { coverageId: uuidSchema, alterId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: coverageLinkResponse.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ coverageId, alterId, ...input }) => { const result = await service.reassignCoverage(ownerId, coverageId, alterId, input.expectedVersion, input.requestId, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Reassigned the coverage record." }] }; });
  server.registerTool("erase_coverage_record", { title: "Erase coverage record", description: "Permanently erase a coverage record to resolve an alter-erasure blocker.", inputSchema: { coverageId: uuidSchema, ...versionMutationSchema.shape }, outputSchema: erasedResponse.shape, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ coverageId, ...input }) => { const result = await service.eraseCoverageRecord(ownerId, coverageId, input.expectedVersion, input.requestId, "MCP"); return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Permanently erased the coverage record." }] }; });

  server.registerTool("save_system_note", { title: "Save private note", description: "Use this only when the user explicitly asks to send a private note into System. Optionally link it to an alter or coverage period, and include actorAlterId only when the user explicitly identifies who the note is from.", inputSchema: noteSchema.shape, outputSchema: noteOutputSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, async (input) => ({ structuredContent: { note: await repository.saveNote(ownerId, noteSchema.parse(input)) }, content: [{ type: "text", text: "Saved the private note to System." }] }));
  server.registerTool("save_system_preference", { title: "Save private preference", description: "Use this only when the user explicitly asks to save a private System preference. It stores the key and value in the user's backend record.", inputSchema: preferenceSchema.shape, outputSchema: preferenceOutputSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, async (input) => { const value = preferenceSchema.parse(input); return { structuredContent: { preference: await repository.savePreference(ownerId, value.key, value.value) }, content: [{ type: "text", text: "Saved the private preference to System." }] }; });
  server.registerTool("get_sticker_pack_draft", {
    title: "Get private sticker pack direction",
    description: "Read the saved ten-reaction sticker direction board for one explicitly selected person. This returns acting directions and semantic slots, not private image bytes. Use it when the user asks to continue or generate that person's sticker pack.",
    inputSchema: { alterId: uuidSchema },
    outputSchema: { pack: stickerPackDraftSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ alterId }) => {
    const alter = await service.getAlter(ownerId, alterId);
    if (alter.archivedAt) throw new Error("Profile is archived.");
    const saved = (await repository.listPreferences(ownerId)).find(item => item.key === `stickers.v1.${alterId}`);
    let pack = defaultStickerPack(alterId);
    if (saved) {
      try { pack = stickerPackDraftSchema.parse(JSON.parse(saved.value)); }
      catch { /* recover to a clean draft rather than expose malformed private state */ }
    }
    return { structuredContent: { pack }, content: [{ type: "text", text: `Loaded the private ten-reaction direction board for ${alter.name}.` }] };
  });
  server.registerTool("save_sticker_pack_draft", {
    title: "Save private sticker pack direction",
    description: "Save an explicitly approved ten-reaction sticker direction board for one person. Use this only after the user asks to save the board; it stores directions, not generated image bytes.",
    inputSchema: stickerPackDraftSchema.shape,
    outputSchema: { pack: stickerPackDraftSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const pack = stickerPackDraftSchema.parse(input);
    const alter = await service.getAlter(ownerId, pack.alterId);
    if (alter.archivedAt) throw new Error("Profile is archived.");
    await repository.savePreference(ownerId, `stickers.v1.${pack.alterId}`, JSON.stringify(pack));
    return { structuredContent: { pack }, content: [{ type: "text", text: `Saved the private ten-reaction direction board for ${alter.name}.` }] };
  });

  server.registerTool("suggest_coverage_draft", { title: "Create coverage draft", description: "Use this when the user asks for a suggested flexible coverage period. It creates an unconfirmed draft from prior confirmed history, an optional manual check-in, and only explicitly passed short ChatGPT context. That context is never retained.", inputSchema: draftSchema.shape, outputSchema: coverageOutputSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, async (input) => { const draftInput = draftSchema.parse(input); const confirmed = await repository.confirmedDuring(ownerId, "0001-01-01", "9999-12-31"); const suggestion = suggestCoverage(draftInput, confirmed); const draft = await repository.createDraft(ownerId, { alterId: suggestion.alterId, startsOn: draftInput.startsOn, endsOn: draftInput.endsOn, reasons: suggestion.reasons }); return { structuredContent: { draft }, content: [{ type: "text", text: "Created an unconfirmed coverage draft with inspectable reasons." }] }; });
  server.registerTool("resolve_coverage_draft", { title: "Confirm, change, or reject coverage draft", description: "Use this only after the user has inspected a specific coverage draft and explicitly requests a confirm, change, or reject action. Only confirmation sends a record into later history.", inputSchema: resolveDraftSchema.shape, outputSchema: coverageOutputSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, async (input) => { const resolution = resolveDraftSchema.parse(input); const draft = await repository.resolveDraft(ownerId, resolution.draftId, resolution.result, resolution.alterId); return { structuredContent: { draft }, content: [{ type: "text", text: resolution.result === "CONFIRMED" ? "Confirmed coverage is now recorded history." : "The draft was rejected and is excluded from history." }] }; });

  const imagePrepareSchema = z.object({ ready: z.literal(true), filename: z.string(), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) });
  const openAIFileSchema = z.object({
    download_url: z.string().url(),
    file_id: z.string().min(1),
    mime_type: z.string().optional(),
    file_name: z.string().min(1).max(255).optional(),
  }).strict();
  const uploadedImageSchema = z.object({ stored: z.literal(true), imageId: uuidSchema, alterId: uuidSchema, contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) });
  server.registerTool("upload_private_image", {
    title: "Upload private image",
    description: "Use this after the user attaches an image and identifies the Bunch profile it belongs to. Bunch downloads the temporary ChatGPT file server-side, stores it in the owner's private Blob gallery, and returns only its private image ID. It does not change the profile picture or appearance references.",
    inputSchema: { alterId: z.string().uuid(), file: openAIFileSchema },
    outputSchema: uploadedImageSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { "openai/fileParams": ["file"], "openai/toolInvocation/invoking": "Saving private image…", "openai/toolInvocation/invoked": "Private image saved." },
  }, async ({ alterId, file }) => {
    const profiles = await repository.listProfiles(ownerId);
    if (!profiles.some((profile) => profile.id === alterId)) throw new Error("Profile not found.");
    await getPilotService().assertAccess(ownerId, "upload");
    const downloaded = await downloadOpenAIImage(file);
    const saved = await savePrivateImage(ownerId, downloaded);
    const id = randomUUID();
    try {
      await repository.attachImage(ownerId, alterId, { id, ...saved, isProfilePicture: false, createdAt: new Date().toISOString() });
    } catch (error) {
      await deletePrivateImages([saved.storageKey]);
      throw error;
    }
    return { structuredContent: { stored: true as const, imageId: id, alterId, contentType: saved.contentType }, content: [{ type: "text", text: "Saved the attached image to the private Bunch gallery. It is not a profile picture or appearance reference yet." }] };
  });
  server.registerTool("prepare_private_image_upload", { title: "Prepare private image upload", description: "Use this only after the user selects an image in the System ChatGPT companion and identifies its profile. It creates a one-time short-lived private upload capability; it does not expose image contents to the model.", inputSchema: { alterId: z.string().uuid(), filename: z.string().min(1).max(255), contentType: z.enum(["image/jpeg", "image/png", "image/webp"]) }, outputSchema: imagePrepareSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } }, async ({ alterId, filename, contentType }) => { const profiles = await repository.listProfiles(ownerId); if (!profiles.some((profile) => profile.id === alterId)) throw new Error("Profile not found."); const capability = issueImageUploadCapability(ownerId, alterId); return { structuredContent: { ready: true as const, filename, contentType }, content: [{ type: "text", text: "Prepared a private image transfer." }], _meta: { uploadEndpoint: `${requiredPublicOrigin()}/api/mcp-image-upload`, uploadCapability: capability } }; });
  server.registerTool("delete_private_image", { title: "Delete private image", description: "Permanently delete one private image only after the user explicitly confirms deleting that specific image. Use kind upload for an uploaded profile or album photo (IDs from get_alter), scene for a Bunch-generated scene (IDs from list_scene_generations), or group for a finished group photo. Repairs made from the image are deleted with it. An image still being generated cannot be deleted yet. Retrying is safe.", inputSchema: { kind: deletableImageKindSchema, imageId: uuidSchema }, outputSchema: { deleted: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }, async ({ kind, imageId }) => {
    const result = await (imageDeletionOverride ?? getImageDeletionService()).delete(ownerId, kind, imageId);
    return { structuredContent: result, content: [{ type: "text", text: result.deleted ? "Permanently deleted the private image." : "No matching image remains, so nothing was deleted." }] };
  });
  server.registerTool("prepare_alter_image_prompt", { title: "Prepare canonical image prompt", description: "Prepare a canonical prompt packet for a trusted external image-studio adapter whose adapter consumes private reference metadata. It generates nothing. In ChatGPT, use prepare_chatgpt_alter_image instead so its widget transfers the actual selected references as transient files; never call generate_scene as a ChatGPT fallback.", inputSchema: imagePromptInputSchema.shape, outputSchema: imagePromptResultSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => withSceneRoute(await prepareAlterImagePrompt(service, ownerId, input, publicOrigin)));
  server.registerTool("prepare_furry_scene", { title: "Prepare external Furry scene", description: "Prepare a canonical multi-character packet for a trusted external image-studio adapter. It returns references in private metadata and generates nothing. In ChatGPT, use prepare_chatgpt_alter_image instead; never call generate_scene as a ChatGPT fallback.", inputSchema: furrySceneInputSchema.shape, outputSchema: imagePromptResultSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (input) => withSceneRoute(await prepareFurryScene(service, ownerId, input, publicOrigin)));
  server.registerTool("prepare_chatgpt_alter_image", { title: "Prepare ChatGPT alter image", description: "Use this for every explicit ChatGPT image request involving named alters, whether or not the user supplied an additional scene, object, or style image. Resolve exact active names or aliases and transfer every selected private appearance reference through the secure widget. The widget asks ChatGPT's image generator to run once; it creates no Bunch image job, provider call, allowance charge, or saved output. Never fall back to generate_scene from ChatGPT.", inputSchema: chatgptAlterImageInputSchema.shape, outputSchema: chatgptAlterImageResultSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { resourceUri: CHATGPT_ALTER_IMAGE_WIDGET_URI }, "openai/outputTemplate": CHATGPT_ALTER_IMAGE_WIDGET_URI, "openai/fileParams": ["sceneImage"], "openai/toolInvocation/invoking": "Preparing private references…", "openai/toolInvocation/invoked": "Private references prepared." } }, async (input) => prepareChatgptAlterImage(service, ownerId, input, publicOrigin));
  const nativeScenes = () => nativeSceneServiceOverride ?? getNativeSceneService();
  const imageAllowance = async () => nativeScenes().allowance?.read(ownerId);
  server.registerTool("get_image_allowance", { title: "Image allowance", description: "Read the shared daily generation, repair and photo-finishing allowance.", inputSchema: {}, outputSchema: imageAllowanceSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async () => {
    const allowance = await imageAllowance();
    if (!allowance) throw new Error("Image allowance unavailable.");
    return { structuredContent: allowance, content: [{ type: "text", text: `${allowance.remaining} of ${allowance.limit} image uses remaining. Resets ${allowance.resetsAt}.` }] };
  });
  const sceneToolMeta = { ui: { resourceUri: SCENE_WIDGET_URI }, "openai/outputTemplate": SCENE_WIDGET_URI };
  // A finished image reaches the chat only through the scene widget. Its
  // render-scoped capability rides in _meta, which hosts give to the widget and
  // never to the model; text and structured content carry only the job.
  const sceneResult = async (render: NativeSceneRender, started: boolean) => {
    const browserUrl = `${publicOrigin}/images?render=${encodeURIComponent(render.id)}`;
    const economyNotice = render.costMode === "ECONOMY" ? " Economy mode used a lower-cost route; check identity details and do not treat the result as canon automatically." : "";
    const text = render.state === "COMPLETE"
      ? `Private scene generated and saved.${economyNotice} The Bunch scene widget shows it in this chat. Display is not confirmed; do not describe the image as visible without checking the rendered widget. If the host cannot render widgets, open its authenticated preview: ${browserUrl}`
      : render.state === "FAILED"
        ? `Private scene generation failed. Do not retry automatically; offer a new explicit generation. Authenticated record: ${browserUrl}`
        : `${started ? "Private scene generation started" : `Private scene generation is ${render.state.toLowerCase()}`}.${economyNotice} The Bunch scene widget follows the job and shows the image in this chat when it completes; do not describe the image before then. If the host cannot render widgets, check get_scene_generation or open its authenticated preview: ${browserUrl}`;
    const sceneImage = render.state === "COMPLETE" ? { src: `${publicOrigin}/api/system/native-scenes/inline/${encodeURIComponent(render.id)}?cap=${encodeURIComponent(issueSceneImageReadCapability(ownerId, render.id))}` } : undefined;
    const allowance = await imageAllowance();
    return { structuredContent: { ...render, ...(allowance ? { allowance } : {}) }, content: [{ type: "text" as const, text }], _meta: sceneImage ? { browserUrl, sceneImage } : { browserUrl } };
  };
  server.registerTool("repair_image", { title: "Repair private image", description: "Repair an owner-authorized private, native or group image by ID. Describe only the requested correction. Costs one shared image use; saves a new image and preserves the original.", inputSchema: { source: repairSourceSchema, correction: z.string().trim().min(1).max(5000), requestId: uuidSchema }, outputSchema: { ...nativeSceneRenderSchema.shape, allowance: imageAllowanceSchema.optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, _meta: sceneToolMeta }, async ({ source, correction, requestId }) => {
    if (!scheduleNativeScene) throw new Error("NATIVE_SCENE_DISPATCH_UNAVAILABLE");
    const render = await nativeScenes().start(ownerId, { repairSource: source, scene: correction, requestId });
    if (render.state === "QUEUED") scheduleNativeScene(ownerId, render.id);
    return sceneResult(render, true);
  });
  server.registerTool("generate_scene", { title: "Generate paid Bunch scene", description: "Start a paid Bunch-native image job only on a Bunch-owned surface or when the user explicitly requests Bunch-native generation. Do not call this from ChatGPT for an ordinary image request: use prepare_chatgpt_alter_image, whose widget sends references to ChatGPT's own image generator. This consumes Bunch provider capacity and image allowance.", inputSchema: nativeSceneInputSchema.shape, outputSchema: { ...nativeSceneRenderSchema.shape, allowance: imageAllowanceSchema.optional() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, _meta: { ...sceneToolMeta, "openai/toolInvocation/invoking": "Starting private scene…", "openai/toolInvocation/invoked": "Private scene job recorded." } }, async input => {
    if (!scheduleNativeScene) throw new Error("NATIVE_SCENE_DISPATCH_UNAVAILABLE");
    const render = await nativeScenes().start(ownerId, input);
    if (render.state === "QUEUED") scheduleNativeScene(ownerId, render.id);
    return sceneResult(render, true);
  });
  server.registerTool("get_scene_generation", { title: "Get private scene generation", description: "Read one private Bunch image-generation job. The Bunch scene widget shows a completed image in chat. A completed image remains private and does not promote canon.", inputSchema: { id: uuidSchema }, outputSchema: { ...nativeSceneRenderSchema.shape, allowance: imageAllowanceSchema.optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ...sceneToolMeta, "openai/widgetAccessible": true } }, async ({ id }) => sceneResult(await nativeScenes().get(ownerId, id), false));
  server.registerTool("list_scene_generations", { title: "List private scene generations", description: "List recent private Bunch image-generation jobs without exposing image bytes or storage details.", inputSchema: {}, outputSchema: { renders: z.array(nativeSceneRenderSchema), allowance: imageAllowanceSchema.optional() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => {
    const renders = await nativeScenes().list(ownerId);
    return { structuredContent: { renders, allowance: await imageAllowance() }, content: [{ type: "text", text: `Listed ${renders.length} private scene generation${renders.length === 1 ? "" : "s"}. Open the authenticated Images page to view completed images.` }], _meta: { browserUrl: `${publicOrigin}/images` } };
  });

  server.registerTool("set_alter_appearance", { title: "Set private appearance references", description: "Set the selected private appearance-reference photos and optional appearance notes for one alter. These are independent of the profile picture and never affect hosting or fronting.", inputSchema: { alterId: uuidSchema, ...setAlterAppearanceSchema.shape }, outputSchema: alterResponseSchema.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ alterId, ...input }) => {
    const result = await service.setAlterAppearance(ownerId, alterId, input, "MCP");
    return { structuredContent: { data: result.data, meta: { requestId: input.requestId, replayed: result.replayed } }, content: [{ type: "text", text: "Saved the selected private appearance references. Profile picture and presence are unchanged." }] };
  });

  const groupPhotoRenderOutputSchema = z.object({ projectId: uuidSchema, status: z.literal("READY"), placements: z.array(z.object({ alterId: uuidSchema, tokenX: z.number().int(), tokenY: z.number().int(), depth: z.number().int(), occupancyZoneId: z.string().nullable() })), prompt: z.string(), identities: imagePromptResultSchema.shape.identities });
  server.registerTool("prepare_group_photo_render", { title: "Prepare Group Photo render", description: "Prepare the selected staged people for an external MCP image studio. This returns deterministic placement, canonical prompts, and capability-secured selected appearance references. It never calls an image model, exposes backplate bytes, or substitutes profile pictures for selected appearance references.", inputSchema: { projectId: uuidSchema }, outputSchema: groupPhotoRenderOutputSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async ({ projectId }) => {
    const project = await getGroupPhotoService().get(ownerId, projectId);
    if (!project.placements.length) throw new Error("Place at least one person before preparing a Group Photo render.");
    const prepared = await prepareAlterImagePrompt(service, ownerId, { alters: project.placements.map((placement) => placement.alterId), scene: compositionGuidance(project.placements) }, publicOrigin);
    if (!prepared.structuredContent.ready) throw new Error(prepared.structuredContent.notices.join(" "));
    return { structuredContent: { projectId, status: "READY" as const, placements: project.placements.map(({ alterId, tokenX, tokenY, depth, occupancyZoneId }) => ({ alterId, tokenX, tokenY, depth, occupancyZoneId })), prompt: prepared.structuredContent.prompt, identities: prepared.structuredContent.identities }, content: [{ type: "text", text: "Prepared an appearance-grounded Group Photo render packet for the image studio. Compose the staged people together with natural poses and spacing, preserving their approximate grouping and layer order." }], _meta: prepared._meta };
  });

  const recordedCoverageSchema = z.object({ period: z.object({ startsOn: z.string().date(), endsOn: z.string().date() }), coverage: z.array(z.object({ id: uuidSchema, alterId: uuidSchema, alterName: z.string(), startsOn: z.string().date(), endsOn: z.string().date().optional() })), handoff: z.string() });
  server.registerTool("get_recorded_coverage", { title: "Get recorded coverage handoff", description: "Use this when the user asks who had recorded coverage during a stated period, including last week. Returns only confirmed records and a concise handoff prompt such as 'go talk to Name for this.'", inputSchema: { startsOn: z.string().date(), endsOn: z.string().date() }, outputSchema: recordedCoverageSchema.shape, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } }, async ({ startsOn, endsOn }) => { const coverage = await repository.confirmedDuring(ownerId, startsOn, endsOn); const handoff = coverage.length === 1 ? `The recorded coverage is ${coverage[0].alterName}. Go talk to ${coverage[0].alterName} for their context.` : coverage.length ? `There are ${coverage.length} confirmed records; ask which coverage period the user means.` : "No confirmed coverage is recorded for that period."; return { structuredContent: { period: { startsOn, endsOn }, coverage, handoff }, content: [{ type: "text", text: handoff }] }; });

  server.registerTool("get_usage_stats", {
    title: "Get Bunch usage stats (operator only)",
    description: "Operator-only admin tool. Returns MCP tool invocation counts for the requested trailing window: totals, a per-tool breakdown with error counts, a per-day series, and a per-owner breakdown (at most 25 owners). Every non-operator account receives FORBIDDEN.",
    inputSchema: { windowDays: z.number().int().min(1).max(90).default(30) },
    outputSchema: usageStatsSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ windowDays }) => {
    await getPilotService().assertOperator(ownerId);
    const stats = await usage.summary(windowDays);
    return { structuredContent: stats, content: [{ type: "text", text: `In the last ${stats.windowDays} day(s): ${stats.totalInvocations} tool invocation(s), ${stats.aiSpend.meaningfulActions} paid image action(s), and $${stats.aiSpend.totalUsd.toFixed(3)} estimated or confirmed AI spend.` }] };
  });
  return server;
}
