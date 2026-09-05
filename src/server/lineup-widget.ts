export function lineupWidget(publicOrigin: string) {
  const safeOrigin = JSON.stringify(publicOrigin);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>DIDdy lineup</title>
  <style>
    :root{color-scheme:dark;font:20px/1.5 system-ui,sans-serif;color:#f8fafc;background:#07111f}
    *{box-sizing:border-box}body{margin:0;padding:12px;background:#07111f}.shell{max-width:960px;margin:auto;border:3px solid #e2e8f0;background:#0b1626}.top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:18px 20px;border-bottom:3px solid #e2e8f0}.brand{font-size:1.45rem;font-weight:950;letter-spacing:.04em}.link{color:#38bdf8;font-weight:900}.intro{padding:22px 20px;background:#102a43;border-bottom:3px solid #e2e8f0}.intro h1{margin:0 0 8px;font-size:clamp(1.9rem,6vw,3rem);line-height:1.05}.intro p{margin:0;color:#e2e8f0}.notice{margin:0;padding:14px 20px;border-bottom:3px solid #e2e8f0;font-weight:850}.lineup{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;padding:20px}.profile{position:relative;border:3px solid #e2e8f0;background:#07111f;padding:14px}.profile.current{border-color:#38bdf8;box-shadow:inset 0 0 0 2px #38bdf8}.badge{display:inline-block;margin:0 0 10px;padding:5px 9px;background:#38bdf8;color:#04131c;font-weight:950}.picture,.fallback{display:grid;width:100%;aspect-ratio:1;place-items:center;border:3px solid #e2e8f0;background:#020617}.picture{object-fit:cover}.fallback{font-size:clamp(2.4rem,11vw,5.5rem);font-weight:950;color:#38bdf8}.profile h2{margin:14px 0 3px;font-size:1.55rem;line-height:1.1}.pronouns,.description,.image-note{margin:7px 0;color:#cbd5e1}.image-note{font-weight:800}.empty{margin:20px;border:3px dashed #e2e8f0;padding:20px;font-weight:850}a:focus-visible{outline:5px solid #fbbf24;outline-offset:4px}
    @media(max-width:560px){body{padding:0}.shell{border-width:0}.top,.intro,.notice,.lineup{padding-left:16px;padding-right:16px}.lineup{grid-template-columns:1fr}.profile h2{font-size:1.65rem}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
<main class="shell">
  <header class="top"><span class="brand">DIDdy</span><a class="link" id="open-site" href="${publicOrigin}/profiles">Manage profiles</a></header>
  <section class="intro"><h1>Alter lineup</h1><p>Each active profile and its selected profile picture.</p></section>
  <p class="notice" id="notice" role="status">Loading your private lineup…</p>
  <section class="lineup" id="lineup" aria-label="Alter lineup"></section>
</main>
<script>
const SITE=${safeOrigin};const byId=id=>document.getElementById(id);let imageManifest=[];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
function initials(name){return String(name||'?').trim().split(/\\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase()||'?';}
function stateFrom(value){return value?.structuredContent||value?.data||value||{};}
function metaFrom(value){return value?._meta||value?.meta||window.openai?.toolResponseMetadata||{};}
function render(value,metadata){const state=stateFrom(value);const meta=metadata||metaFrom(value);if(Array.isArray(meta?.privateImages))imageManifest=meta.privateImages;const profiles=Array.isArray(state.profiles)?state.profiles:[];const hostId=state.presence?.hosting?.alterId;const frontIds=new Set((state.presence?.fronting||[]).map(p=>p.alterId));byId('lineup').innerHTML=profiles.length?profiles.map(profile=>{const picture=imageManifest.find(image=>image.alterId===profile.id&&image.isProfilePicture);const hosting=profile.id===hostId;const fronting=frontIds.has(profile.id);const current=hosting||fronting;const pictureHtml=picture?'<img class="picture" src="'+esc(picture.src)+'" alt="Profile picture for '+esc(profile.name)+'">':'<div class="fallback" role="img" aria-label="No selected profile picture for '+esc(profile.name)+'">'+esc(initials(profile.name))+'</div>';const note=picture?'Selected profile picture':profile.imageCount?'No profile picture selected':'No profile picture yet';return '<article class="profile '+(current?'current':'')+'">'+(hosting?'<p class="badge">HOSTING</p>':'')+(fronting?'<p class="badge">FRONTING</p>':'')+pictureHtml+'<h2>'+esc(profile.name)+'</h2>'+(profile.pronouns?'<p class="pronouns">'+esc(profile.pronouns)+'</p>':'')+(profile.description?'<p class="description">'+esc(profile.description)+'</p>':'')+'<p class="image-note">'+esc(note)+'</p></article>';}).join(''):'<p class="empty">No active alter profiles are available.</p>';byId('notice').textContent=profiles.length?profiles.length+' active profile'+(profiles.length===1?'':'s')+' in the lineup.':'No active profiles found.';}
byId('open-site').onclick=event=>{if(window.openai?.openExternal){event.preventDefault();window.openai.openExternal({href:event.currentTarget.href});}};
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.method==='ui/notifications/tool-result')render(message.params?.structuredContent,message.params?._meta);},{passive:true});
if(window.openai?.toolOutput)render(window.openai.toolOutput,window.openai.toolResponseMetadata);
</script>
</body>
</html>`;
}
