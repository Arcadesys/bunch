// Follows one private scene job in the chat and shows the finished image. The
// image URL arrives only in tool-result metadata, which hosts hand to this widget
// and never to the model.
export function sceneWidget(publicOrigin: string) {
  const safeOrigin = JSON.stringify(publicOrigin);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Bunch scene</title>
  <style>
    :root{color-scheme:dark;font:20px/1.5 system-ui,sans-serif;color:#f8fafc;background:#07111f}
    *{box-sizing:border-box}body{margin:0;padding:12px;background:#07111f}.shell{max-width:760px;margin:auto;border:3px solid #e2e8f0;background:#0b1626}.top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:16px 20px;border-bottom:3px solid #e2e8f0}.brand{font-size:1.3rem;font-weight:950;letter-spacing:.04em}.link{color:#38bdf8;font-weight:900}.state{display:inline-block;padding:4px 10px;background:#38bdf8;color:#04131c;font-weight:950}.state[data-state="FAILED"]{background:#fca5a5}.body{padding:18px 20px}.scene{margin:0 0 6px;font-size:1.15rem;font-weight:800}.people{margin:0;color:#cbd5e1}.notice{margin:0;padding:14px 20px;border-top:3px solid #e2e8f0;background:#102a43;font-weight:850}.figure{margin:0;border-top:3px solid #e2e8f0;background:#020617}.figure img{display:block;width:100%;height:auto}a:focus-visible{outline:5px solid #fbbf24;outline-offset:4px}
    @media(max-width:560px){body{padding:0}.shell{border-width:0}.top,.body,.notice{padding-left:16px;padding-right:16px}}
  </style>
</head>
<body>
<main class="shell">
  <header class="top"><span class="brand">Bunch scene</span><span class="state" id="state">Loading</span></header>
  <section class="body"><p class="scene" id="scene"></p><p class="people" id="people"></p></section>
  <figure class="figure" id="figure" hidden><img id="image" alt=""></figure>
  <p class="notice" id="notice" role="status">Loading your private scene…</p>
  <p class="body"><a class="link" id="open-site" href="${publicOrigin}/images" target="_blank" rel="noopener noreferrer">Open in Bunch</a></p>
</main>
<script>
const SITE=${safeOrigin};const byId=id=>document.getElementById(id);
const LABELS={QUEUED:'Queued',RUNNING:'Generating',COMPLETE:'Ready',FAILED:'Failed'};const RANK={QUEUED:0,RUNNING:1,COMPLETE:2,FAILED:2};
const POLL_MS=5000,MAX_POLLS=80,MAX_FAILURES=3;
let current=null,imageSrc='',pollTimer=0,polls=0,failures=0,refreshedImage=false,initialized=false,callId=1;const pending=new Map();
function stateFrom(value){const state=value?.structuredContent??value?.result?.structuredContent??value;return state&&typeof state.id==='string'&&typeof state.state==='string'?state:null;}
function metaFrom(value){return value?._meta??value?.result?._meta??value?.meta??null;}
function callTool(name,args){
  if(window.openai?.callTool)return Promise.resolve(window.openai.callTool(name,args));
  if(window.parent===window)return Promise.reject(new Error('No host bridge.'));
  return new Promise((resolve,reject)=>{const id='scene-call-'+(callId++);pending.set(id,{resolve,reject});window.parent.postMessage({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}},'*');setTimeout(()=>{if(pending.delete(id))reject(new Error('Timed out.'));},20000);});
}
function notice(text){byId('notice').textContent=text;}
function stopPolling(){clearTimeout(pollTimer);pollTimer=0;}
function render(value,metadata){
  const state=stateFrom(value);if(!state)return false;
  // Host globals can replay the original tool output after polling has moved on.
  if(current&&current.id===state.id&&(RANK[state.state]??0)<(RANK[current.state]??0))return true;
  current=state;clearTimeout(loadingTimer);
  const meta=metadata??metaFrom(value);
  if(typeof meta?.browserUrl==='string')byId('open-site').href=meta.browserUrl;
  if(typeof meta?.sceneImage?.src==='string')imageSrc=meta.sceneImage.src;
  byId('state').textContent=LABELS[state.state]||state.state;byId('state').dataset.state=state.state;
  byId('scene').textContent=state.scene||'';
  byId('people').textContent=Array.isArray(state.alterNames)&&state.alterNames.length?'With '+state.alterNames.join(', '):'No named people';
  if(state.state==='COMPLETE'){
    stopPolling();
    if(imageSrc){const image=byId('image');image.alt='Private generated scene: '+(state.scene||'');if(image.getAttribute('src')!==imageSrc)image.src=imageSrc;byId('figure').hidden=false;notice('Your private scene is ready. It is saved in Bunch and does not change anyone’s profile.');}
    else{byId('figure').hidden=true;notice('Your private scene is ready. Open it in Bunch to view it.');}
  }else if(state.state==='FAILED'){
    stopPolling();byId('figure').hidden=true;notice('This scene could not be generated'+(state.errorMessage?': '+state.errorMessage:'.')+' Ask for a new image to try again.');
  }else{
    byId('figure').hidden=true;notice('Generating your private scene. This can take a few minutes; this card updates when it is ready.');schedulePoll();
  }
  return true;
}
function schedulePoll(){
  if(pollTimer||!current)return;
  if(polls>=MAX_POLLS){notice('Still generating. Open it in Bunch, or ask to check the scene again.');return;}
  pollTimer=setTimeout(poll,POLL_MS);
}
async function poll(){
  pollTimer=0;polls++;
  try{const result=await callTool('get_scene_generation',{id:current.id});if(result?.isError)throw new Error('Tool error.');failures=0;if(!render(result))schedulePoll();}
  catch{failures++;if(failures>=MAX_FAILURES){notice('This card cannot check progress here. Open it in Bunch, or ask to check the scene again.');return;}schedulePoll();}
}
function imageUnavailable(){byId('figure').hidden=true;notice('The preview link expired. Open the scene in Bunch to view it.');}
byId('image').addEventListener('error',async()=>{
  if(refreshedImage||!current){imageUnavailable();return;}
  refreshedImage=true;
  try{const meta=metaFrom(await callTool('get_scene_generation',{id:current.id}));if(typeof meta?.sceneImage?.src==='string'){imageSrc=meta.sceneImage.src;byId('image').src=imageSrc;return;}}catch{}
  imageUnavailable();
});
byId('open-site').onclick=event=>{if(window.openai?.openExternal){event.preventDefault();window.openai.openExternal({href:event.currentTarget.href});}};
const loadingTimer=setTimeout(()=>{if(!current)notice('The private scene could not load. Open it in Bunch, or ask to check the scene again.');},15000);
window.addEventListener('message',event=>{
  if(event.source!==window.parent)return;
  const message=event.data;
  if(!message||message.jsonrpc!=='2.0')return;
  if(message.id&&pending.has(message.id)){const call=pending.get(message.id);pending.delete(message.id);if(message.error)call.reject(message.error);else call.resolve(message.result);return;}
  if(message.id==='scene-initialize'&&!initialized){if(message.result){initialized=true;window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');}return;}
  if(message.method==='ui/notifications/tool-result'){if(message.params?.isError){clearTimeout(loadingTimer);notice('This scene could not be started. Ask for a new image to try again.');return;}render(message.params);}
  if(message.method==='ui/notifications/tool-cancelled'){clearTimeout(loadingTimer);notice('This scene request was cancelled.');}
},{passive:true});
window.addEventListener('openai:set_globals',event=>{
  const globals=event.detail?.globals;
  if(!globals)return;
  const value=globals.toolOutput??window.openai?.toolOutput;
  if(value)render(value,globals.toolResponseMetadata??window.openai?.toolResponseMetadata);
},{passive:true});
if(window.openai?.toolOutput)render(window.openai.toolOutput,window.openai.toolResponseMetadata);
if(window.parent!==window)window.parent.postMessage({jsonrpc:'2.0',id:'scene-initialize',method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Bunch scene',version:'1.0.0'},appCapabilities:{availableDisplayModes:['inline']}}},'*');
</script>
</body>
</html>`;
}
