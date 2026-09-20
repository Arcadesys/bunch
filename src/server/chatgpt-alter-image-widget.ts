/**
 * A private-reference handoff surface for ChatGPT image generation.
 *
 * The HTML is intentionally self-contained: hosts can register the returned
 * string as a text/html MCP App resource without exposing reference
 * capabilities to the model or to the visible card.
 */
export function chatgptAlterImageWidget(publicOrigin: string) {
  const safeOrigin = JSON.stringify(new URL(publicOrigin).origin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Preparing references</title>
<style>
:root{color-scheme:dark;font:20px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8fafc;background:#0b1020}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;padding:20px;background:#0b1020}.card{max-width:900px;margin:auto;border:3px solid #cbd5e1;border-radius:18px;overflow:hidden;background:#111827;box-shadow:0 12px 40px #0008}.header{padding:26px 30px;background:#172554;border-bottom:3px solid #cbd5e1}.eyebrow{margin:0 0 5px;color:#bae6fd;font-size:.9rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.title{margin:0;font-size:clamp(1.45rem,3vw,2rem);line-height:1.15}.body{padding:26px 30px}.request{margin:0 0 22px;font-size:1.1rem;font-weight:800}.file{display:flex;align-items:center;gap:14px;margin:0 0 24px;padding:14px 16px;border:2px solid #64748b;border-radius:12px;background:#0f172a}.file-icon{display:grid;place-items:center;width:50px;height:50px;border-radius:8px;background:#38bdf8;color:#082f49;font-size:1.5rem;font-weight:950}.file-copy{min-width:0}.file-label{margin:0;font-weight:900}.file-detail{margin:2px 0 0;color:#cbd5e1;font-size:.9rem;overflow-wrap:anywhere}.statuses{display:grid;gap:14px;margin:0;padding:0;list-style:none}.status{display:flex;align-items:flex-start;gap:14px;padding:15px 16px;border:2px solid #475569;border-radius:12px;background:#0f172a}.status-icon{flex:0 0 auto;display:grid;place-items:center;width:38px;height:38px;border:2px solid #94a3b8;border-radius:50%;font-size:1.05rem;font-weight:950}.status[data-state="done"]{border-color:#4ade80}.status[data-state="active"]{border-color:#38bdf8}.status[data-state="error"]{border-color:#fca5a5}.status[data-state="done"] .status-icon{background:#166534;border-color:#86efac}.status[data-state="active"] .status-icon{background:#075985;border-color:#7dd3fc}.status[data-state="error"] .status-icon{background:#7f1d1d;border-color:#fecaca}.status-copy{min-width:0}.status-title{margin:0;font-weight:900}.status-detail{margin:3px 0 0;color:#cbd5e1;font-size:.92rem}.privacy{margin:26px 0 0;padding:16px 18px;border:2px solid #fbbf24;border-radius:12px;background:#422006;color:#fef3c7;font-weight:800}.output{margin-top:28px;padding:28px 20px;min-height:235px;display:grid;place-items:center;text-align:center;border:3px dashed #64748b;border-radius:14px;background:#020617}.output-title{margin:0;font-size:1.2rem;font-weight:900}.output-detail{margin:8px 0 0;color:#cbd5e1}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:600px){body{padding:0}.card{border-width:0;border-radius:0}.header,.body{padding:22px 18px}.status{padding:13px}.output{min-height:190px}}
</style>
</head>
<body>
<main class="card" aria-labelledby="title">
<header class="header"><p class="eyebrow">Bunch</p><h1 class="title" id="title">Preparing references</h1></header>
<section class="body">
<p class="request" id="request">Preparing your image generation…</p>
<div class="file" id="scene-file" hidden><span class="file-icon" aria-hidden="true">▣</span><div class="file-copy"><p class="file-label">Scene image received</p><p class="file-detail" id="scene-detail"></p></div></div>
<ol class="statuses" aria-label="Generation progress">
<li class="status" id="scene-status" data-state="active"><span class="status-icon" aria-hidden="true">…</span><div class="status-copy"><p class="status-title">Piano image received</p><p class="status-detail" id="scene-status-detail">Waiting for the uploaded scene image.</p></div></li>
<li class="status" id="reference-status"><span class="status-icon" aria-hidden="true">2</span><div class="status-copy"><p class="status-title">Private appearance references ready</p><p class="status-detail" id="reference-status-detail">References stay private during this generation.</p></div></li>
<li class="status" id="generation-status"><span class="status-icon" aria-hidden="true">3</span><div class="status-copy"><p class="status-title">Generating securely in ChatGPT</p><p class="status-detail" id="generation-status-detail">The image will use the scene first and private references only for this request.</p></div></li>
</ol>
<p class="privacy">Reference images are shared only for this generation.</p>
<section class="output" aria-live="polite" aria-label="Generated image preview"><div><p class="output-title" id="output-title">Your generated image will appear here.</p><p class="output-detail" id="output-detail">ChatGPT will show the result below when generation is complete.</p></div></section>
<p class="sr-only" id="announce" role="status"></p>
</section>
</main>
<script>
(() => {
  const SITE = ${safeOrigin};
  const MAX_BYTES = 5 * 1024 * 1024;
  const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp']);
  const el = id => document.getElementById(id);
  const text = (id, value) => { if (el(id)) el(id).textContent = value; };
  const phase = (name, detail) => {
    const node = el(name + '-status');
    if (!node) return;
    node.dataset.state = 'done';
    node.querySelector('.status-icon').textContent = '✓';
    text(name + '-status-detail', detail);
  };
  const fail = message => {
    ['scene','reference','generation'].forEach(name => {
      const node = el(name + '-status');
      if (node && name === 'generation') { node.dataset.state = 'error'; node.querySelector('.status-icon').textContent = '!'; }
    });
    text('generation-status-detail', message);
    text('output-title', 'Generation could not start.');
    text('output-detail', 'No private reference was generated or shared. Please try again.');
    text('announce', message);
  };
  const outputFrom = value => value?.structuredContent ?? value?.result?.structuredContent ?? value ?? {};
  const metaFrom = value => value?._meta ?? value?.result?._meta ?? value?.meta ?? {};
  const globalsFrom = () => window.openai?.toolOutput ?? window.openai?.toolResponse?.structuredContent ?? null;
  const metadataFromGlobals = () => window.openai?.toolResponseMetadata ?? window.openai?.toolResponse?._meta ?? null;
  const bridge = (message) => { if (window.parent !== window) window.parent.postMessage(message, '*'); };
  const getState = () => window.openai?.widgetState ?? window.__bunchWidgetState ?? {};
  const setState = async state => {
    window.__bunchWidgetState = state;
    if (window.openai?.setWidgetState) await window.openai.setWidgetState(state);
  };
  const sendFollowUp = prompt => {
    if (window.openai?.sendFollowUpMessage) return Promise.resolve(window.openai.sendFollowUpMessage({prompt}));
    bridge({jsonrpc:'2.0', method:'ui/message', params:{role:'user',content:[{type:'text',text:prompt}]}});
    return Promise.resolve();
  };
  const safeIdentity = value => typeof value === 'string' ? value : '';
  async function run(value, metadata) {
    const data = outputFrom(value), meta = metadata || metaFrom(value);
    const scene = meta.sceneImage || meta.scene_image || {};
    const identities = Array.isArray(data.identities) ? data.identities : [];
    const alterNames = identities.map(identity => safeIdentity(identity?.alterName)).filter(Boolean);
    const expectedReferenceNames = identities.flatMap(identity => Array.from({length:Number(identity?.referenceCount) || 0}, () => safeIdentity(identity?.alterName))).filter(Boolean);
    const media = Array.isArray(meta.referenceMedia) ? meta.referenceMedia : [];
    const current = getState();
    if (alterNames.length) text('title', 'Preparing ' + alterNames.join(', ') + ' references');
    text('request', data.scene ? 'Generate an image of ' + data.scene + '.' : 'Preparing your image generation…');
    if (!scene.file_id || !alterNames.length || !expectedReferenceNames.length || media.length !== expectedReferenceNames.length) { fail('Required scene or appearance references are unavailable.'); return; }
    el('scene-file').hidden = false; text('scene-detail', 'Uploaded scene image'); phase('scene', 'The uploaded scene image is ready.');
    if (current.phase === 'sent' || current.phase === 'complete') { phase('reference', 'Private references are already prepared for this request.'); phase('generation', 'ChatGPT is handling this generation.'); return; }
    try {
      if (!window.openai?.uploadFile || !window.openai?.setWidgetState) throw new Error('ChatGPT image handoff is unavailable in this host.');
      const imageIds = [scene.file_id];
      const prepared = [];
      for (let index = 0; index < media.length; index += 1) {
        const item = media[index];
        const url = new URL(item.src);
        if (url.origin !== SITE || !url.pathname.startsWith('/api/system/images/inline/') || !url.searchParams.has('cap') || safeIdentity(item.alterName) !== expectedReferenceNames[index]) throw new Error('A private reference is not authorized for this handoff.');
        const response = await fetch(url, {redirect:'error', credentials:'same-origin'});
        if (!response.ok) throw new Error('A private reference could not be fetched.');
        const declaredType = safeIdentity(item.contentType).toLowerCase();
        const type = (response.headers.get('content-type') || declaredType).split(';')[0].toLowerCase();
        const declaredLength = Number(response.headers.get('content-length') || 0);
        const blob = await response.blob();
        if (!IMAGE_TYPES.has(type) || (declaredType && type !== declaredType) || declaredLength > MAX_BYTES || blob.size > MAX_BYTES) throw new Error('A private reference is not a supported image.');
        const file = new File([blob], 'reference-' + (index + 1) + '.' + (type === 'image/jpeg' ? 'jpg' : type.slice(6)), {type});
        const uploaded = await window.openai.uploadFile(file, {library:false});
        if (!uploaded?.fileId && !uploaded?.id) throw new Error('A private reference could not be uploaded.');
        imageIds.push(uploaded.fileId || uploaded.id); prepared.push(expectedReferenceNames[index]);
      }
      phase('reference', 'Private references are ready for ' + prepared.join(', ') + '.');
      const modelContent = 'Use image 1 as the scene image. The following images are private appearance references, in order: ' + prepared.map((name, index) => 'image ' + (index + 2) + ' is for ' + name).join('; ') + '.';
      const state = {phase:'sent', imageIds, modelContent, privateContent:{phase:'sent'}};
      await setState(state);
      await sendFollowUp('Use ChatGPT image generation now for this request: ' + data.scene + '. Image 1 is the scene; the remaining images are private appearance references in the order described in the handoff. Do not call Bunch again for this generation.');
      phase('generation', 'Generating securely in ChatGPT now.');
      text('announce', 'References transferred securely. ChatGPT is generating the image.');
    } catch (error) { fail(error instanceof Error ? error.message : 'The secure image handoff could not start.'); }
  }
  const initial = globalsFrom();
  if (initial) run(initial, metadataFromGlobals());
  window.addEventListener('openai:set_globals', event => { const globals = event.detail?.globals || {}; if (globals.toolOutput) run(globals.toolOutput, globals.toolResponseMetadata); }, {passive:true});
  window.addEventListener('message', event => { if (event.source === window.parent && event.data?.method === 'ui/notifications/tool-result') run(event.data.params, event.data.params?._meta); }, {passive:true});
  bridge({jsonrpc:'2.0',id:'alter-image-initialize',method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Bunch image handoff',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline']}}});
})();
</script>
</body>
</html>`;
}

// Alias kept intentionally small so resource registration can use the same
// naming convention as the other server-side widget generators.
export const alterImageWidget = chatgptAlterImageWidget;
