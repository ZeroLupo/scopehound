// Templates — HTML page templates for all UI pages.

// ─── FAVICON (embedded data URI) ─────────────────────────────────────────────

export const FAVICON_LINK = '<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAACshmLzAAAECElEQVRYCe1WS28bVRT+7jxtz9iOSWM7hlQlpKItdMEWlecKiTViwZINK3b8BH5AIyGxQGIDG/aIJUKqxKYLqiiiVI1ISfNyEtvjmfG87oNzDZHYIF+g6oYcyxrNzLnn+853zj13gAv7vytg/wcBfATBpdD3g7IsOcUR/yYW+yeLgiDobVwP311q+e/U6s5NMLbCFJRU8jTPxNY4Kr/79UHybZIkQ9O4RgTW1zvtzkrj4363/lEQOgMlgYKXKCtKWil4rgPXdmHbDOms2j8a5p9Hp9nmw4ej6SIiRiV44erS+xtX25tFVTSTtARTFoFzMPoRPipNRFqIsxyOy1r9buPtLKvuH+wn9xYRcBY56PeNwMNsViJOCzR8H9mME5CFet0DFxKcV8gyeuYxTJOMVPljjUlsy8SJfHJKlkrOUPPcedYOyS6o9eJpCSUsWBaD77uwtC7kJxmIyWIzIiCEyqEYLApccYnxJEO7sAhYQgqF6bTA6VmKsqBSMHpOCnCuisXwIMIGpriVaF11ZpwI2HR966wGNeVUlhJh6GEyySEJ+byrRSVTg9BmBDJeTgVFJ1wIKXWn42t3hKMsw6AfYjBo07NyTo4EIAWUot6InhiBvLQjqmyh68xLSY2W48HjMxSloNpbGI9nuPlSn8qh7zUsKxWtMSFgtAvKuIqg3NRiVk3REOgs1bFE/xvXu/OyTIiAoH6YZVQemgU0m5JYrzEwox7Y2TmeUPwTrYC24UkCh4B+25tgd3dE9ynubR2BV3L+nCl2otcY4MNIAQpUUuI7sNS1RmhT0/k4OIyxvBxASr0LcoSBj7DlUiMKms3Wjl5jQsBIAR2o4uqu69h6xqDTqSFOirns1G+YRBnCpgNmK1LABu2Auybg2seYwOOh+CnJCGxaIaZJGMUVEVCUMTBNOWa5wiiqkKQS+8d84Qg+J3i+bc/v/+7qfPhe9/srfXWroDoLrubgh7MluA7DJW8Ml0az79NEpL26e4Qfv/hm5U1ge2EZDHtgw35+Ne21GxKu3naUZZIxDMIZEVCo03huNhgmiYTnWbjcVV0gNVLXkABQoyNgHCsstxjGiULgM/pLTFJF/WERuMAoBr0XqPmWbhUjM2IJtOWjocgJUIxjgXYDGCxLakiB1WVF2Qt0msDLVxgRkCJKBZ0DJI2BmfYAar32uq2ysFmrX7vxYuerNM9dTschHVFUBqq/51XbP48+4FX5i0Q9jYaR3ooLzeiDREfhaTGuUnGcRMX2YK3lrD0bvkGfYlRzG/1eC1HEP72/dfJZTj4F+S5E/tPBmMBfA+49iu48sxKurfaCV4K6j8OD2Zd3ftj7hHzoY+3pmXvr9cu3X33tuU2CdJ8e7AXShQJPWIHfAXwg+fjvUdswAAAAAElFTkSuQmCC">';

// ─── DASHBOARD HTML ──────────────────────────────────────────────────────────

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Competitive Intelligence</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.5}
a{color:#7a8c52;text-decoration:none}
a:hover{text-decoration:underline}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.subtitle{color:#6b7280;font-size:13px}
nav{display:flex;gap:4px;background:#12161a;padding:8px 24px;border-bottom:1px solid #2a3038}
nav button{background:none;border:1px solid transparent;color:#6b7280;padding:8px 16px;border-radius:2px;cursor:pointer;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600}
nav button:hover{color:#d4d8de}
nav button.active{background:#1a1f25;color:#d4d8de;border-color:#2a3038}
main{max-width:1200px;margin:0 auto;padding:24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px}
.card h3{font-size:15px;margin-bottom:4px;font-weight:700}
.card .url{color:#6b7280;font-size:12px;margin-bottom:12px}
.card .pages{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.pill{font-size:11px;padding:3px 8px;border-radius:2px;background:#1a1f25;border:1px solid #2a3038;text-transform:uppercase;letter-spacing:0.03em}
.pill.changed{border-color:#c4a747;color:#c4a747}
.pill.stable{border-color:#3d6b35;color:#3d6b35}
.pill.new{border-color:#6b7280;color:#6b7280}
.legend{display:flex;gap:16px;justify-content:flex-end;font-size:11px;color:#6b7280;margin-top:12px}
.legend span{display:flex;align-items:center;gap:4px}
.legend .dot{width:8px;height:8px;border-radius:1px;border:1px solid}
.feed{display:flex;flex-direction:column;gap:12px}
.event{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px}
.event-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.05em}
.badge.high{background:#c2303022;color:#c23030;border:1px solid #c2303066}
.badge.medium{background:#c4a74722;color:#c4a747;border:1px solid #c4a74766}
.badge.low{background:#3d6b3522;color:#3d6b35;border:1px solid #3d6b3566}
.event .meta{color:#6b7280;font-size:12px}
.event .summary{margin:6px 0}
.event .detail{color:#6b7280;font-size:13px;margin-top:4px}
.event .diff{font-size:12px;margin-top:8px;padding:8px;background:#0a0c0e;border-radius:2px;border:1px solid #2a3038}
.diff .removed{color:#c23030}
.diff .added{color:#3d6b35}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1a1f25;font-size:13px}
th{color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em}
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.pricing-card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px}
.pricing-card h3{margin-bottom:12px}
.plan{padding:8px 0;border-bottom:1px solid #1a1f25}
.plan:last-child{border-bottom:none}
.plan-name{font-weight:700;font-size:14px}
.plan-price{color:#5c6b3c;font-size:13px}
.plan-features{color:#6b7280;font-size:12px;margin-top:4px}
.empty{text-align:center;padding:48px;color:#6b7280}
.loading{text-align:center;padding:48px;color:#6b7280}
.setup-banner{background:#1a1f25;border:1px solid #c4a747;padding:12px 24px;text-align:center;color:#c4a747;font-size:14px}
.setup-banner a{color:#c4a747;text-decoration:underline}
</style>
</head>
<body>
<header>
<div><h1>Scope<span>Hound</span></h1></div>
<div style="display:flex;align-items:center;gap:16px"><span class="subtitle" id="lastUpdated">Loading...</span><span id="userBar" style="font-size:12px;color:#6b7280"></span></div>
</header>
<nav>
<button class="active" data-tab="overview">Overview</button>
<button data-tab="changes">Recent Changes</button>
<button data-tab="pricing">Pricing</button>
<button data-tab="seo">SEO Signals</button>
<div style="margin-left:auto;display:flex;align-items:center;gap:8px">
<button id="scanBtn" onclick="triggerScan()" style="font-size:12px;padding:8px 16px;background:#5c6b3c;color:#d4d8de;border:none;border-radius:2px;cursor:pointer;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;display:none">Scan Now</button>
<span id="scanCooldown" style="font-size:11px;color:#6b7280;display:none"></span>
<a href="/setup" style="font-size:12px;color:#6b7280;padding:8px 12px;border:1px solid #2a3038;border-radius:2px;text-decoration:none;display:flex;align-items:center;gap:4px">+ Manage Competitors</a>
</div>
</nav>
<div id="slackBanner" style="display:none;background:#1a0505;border:1px solid #3a1515;color:#e8a0a0;padding:12px 16px;font-size:13px;margin:0 0 1px 0"></div>
<main>
<div id="content"><div class="loading">Loading dashboard data...</div></div>
</main>
<script>
let DATA=null;
const $=id=>document.getElementById(id);
const content=$("content");
function timeAgo(d){if(!d)return"awaiting scan";const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";const days=Math.floor(s/86400);return days===1?"yesterday":days+"d ago";}
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function pageStatus(p){if(!p.lastChecked)return"new";if(!p.lastChanged)return"stable";const d=(Date.now()-new Date(p.lastChanged))/86400000;return d<7?"changed":"stable";}
function renderOverview(){if(!DATA.competitors||DATA.competitors.length===0){content.innerHTML='<div class="empty">No competitors configured. <a href="./setup">Run setup</a> to get started.</div>';return;}let h='<div class="grid">';for(const c of DATA.competitors){h+='<div class="card"><h3><a href="'+esc(c.website)+'" target="_blank">'+esc(c.name)+'</a></h3><div class="url">'+esc(c.website)+'</div><div class="pages">';for(const p of c.pages){const s=pageStatus(p);h+='<span class="pill '+s+'">'+esc(p.label)+' · '+timeAgo(p.lastChecked)+'</span>';}if(c.blogRss)h+='<span class="pill stable">Blog RSS</span>';h+='</div>';if(c.pricing&&c.pricing.plans&&c.pricing.plans.length>0){h+='<div style="font-size:12px;color:#6b7280">Plans: '+c.pricing.plans.map(p=>esc(p.name)+' ('+esc(p.price)+')').join(' · ')+'</div>';}h+='</div>';}h+='</div>';h+='<div class="legend"><span><span class="dot" style="border-color:#3d6b35;background:#3d6b3522"></span>Stable</span><span><span class="dot" style="border-color:#c4a747;background:#c4a74722"></span>Changed recently</span><span><span class="dot" style="border-color:#6b7280;background:#6b728022"></span>Awaiting scan</span></div>';content.innerHTML=h;}
function renderChanges(){if(!DATA.recentChanges||DATA.recentChanges.length===0){content.innerHTML='<div class="empty">No changes recorded yet. Run a scan to start tracking.</div>';return;}let h='<div class="feed">';for(const e of DATA.recentChanges){h+='<div class="event"><div class="event-header"><span class="badge '+(e.priority||"low")+'">'+(e.priority||"low")+'</span>';if(e.competitor)h+='<strong>'+esc(e.competitor)+'</strong>';if(e.pageLabel)h+=' · '+esc(e.pageLabel);h+='<span class="meta">'+timeAgo(e.date)+'</span></div><div class="summary">'+esc(e.summary)+'</div>';if(e.analysis)h+='<div class="detail">'+esc(e.analysis)+'</div>';if(e.recommendation)h+='<div class="detail"><strong>Action:</strong> '+esc(e.recommendation)+'</div>';if(e.diff&&(e.diff.before||e.diff.after)){h+='<div class="diff">';if(e.diff.before)h+='<div class="removed">- '+esc(e.diff.before.slice(0,200))+'</div>';if(e.diff.after)h+='<div class="added">+ '+esc(e.diff.after.slice(0,200))+'</div>';h+='</div>';}if(e.url)h+='<div style="margin-top:6px"><a href="'+esc(e.url)+'" target="_blank">View</a></div>';h+='</div>';}h+='</div>';content.innerHTML=h;}
function renderPricing(){if(!DATA.competitors||DATA.competitors.length===0){content.innerHTML='<div class="empty">No competitors configured. <a href="./setup">Run setup</a> to get started.</div>';return;}let h='<div class="pricing-grid">';for(const c of DATA.competitors){h+='<div class="pricing-card"><h3>'+esc(c.name)+'</h3>';if(!c.pricing||!c.pricing.plans||c.pricing.plans.length===0){h+='<div class="empty" style="padding:12px 0;font-size:13px">No pricing data yet. Add a pricing page and run a scan.</div>';}else{for(const p of c.pricing.plans){h+='<div class="plan"><div class="plan-name">'+esc(p.name)+'</div><div class="plan-price">'+esc(p.price)+'</div>';if(p.features&&p.features.length)h+='<div class="plan-features">'+p.features.map(f=>esc(f)).join(' · ')+'</div>';h+='</div>';}if(c.pricing.notes&&c.pricing.notes!=="No pricing found")h+='<div style="font-size:12px;color:#6b7280;margin-top:8px">'+esc(c.pricing.notes)+'</div>';}h+='</div>';}h+='</div>';content.innerHTML=h;}
function renderSeo(){let h='<table><thead><tr><th>Competitor</th><th>Page</th><th>Title</th><th>Meta Description</th><th>H1</th></tr></thead><tbody>';let any=false;for(const c of DATA.competitors){if(!c.seo||Object.keys(c.seo).length===0)continue;for(const p of c.pages){const s=c.seo[p.id];if(!s)continue;any=true;h+='<tr><td>'+esc(c.name)+'</td><td>'+esc(p.label)+'</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.title||"—")+'</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.metaDescription||"—")+'</td><td>'+esc((s.h1s||[]).join(", ")||"—")+'</td></tr>';}}if(!any)h+='<tr><td colspan="5" class="empty">No SEO data yet.</td></tr>';h+='</tbody></table>';content.innerHTML=h;}
const tabs={overview:renderOverview,changes:renderChanges,pricing:renderPricing,seo:renderSeo};
document.querySelectorAll("nav button").forEach(btn=>{btn.addEventListener("click",()=>{document.querySelectorAll("nav button").forEach(b=>b.classList.remove("active"));btn.classList.add("active");if(DATA)tabs[btn.dataset.tab]();});});
fetch("./api/dashboard-data").then(r=>r.json()).then(d=>{DATA=d;$("lastUpdated").textContent="Last scan: "+timeAgo(d.generatedAt);renderOverview();}).catch(()=>{content.innerHTML='<div class="empty">Failed to load data. <a href="./setup">Run setup</a> or hit /test first.</div>';});
fetch("./api/user/profile").then(r=>r.ok?r.json():null).then(u=>{if(u&&u.email){$("userBar").innerHTML=esc(u.email)+' &middot; <a href="/auth/logout" style="color:#c23030;text-decoration:none">Sign out</a>';}}).catch(()=>{});
fetch("./api/config").then(r=>r.ok?r.json():null).then(c=>{if(c&&!c.settings?.slackWebhookUrl){const b=$("slackBanner");b.innerHTML='Your Slack alerts are not connected. Scan results will not be delivered. <a href="/setup" style="color:#e8a0a0;text-decoration:underline">Connect Slack in Setup</a>';b.style.display="block";}}).catch(()=>{});
// ── Scan Now button with cooldown ──
function updateScanButton(status){
  const btn=$("scanBtn"),cd=$("scanCooldown");
  if(!status){btn.style.display="none";cd.style.display="none";return;}
  if(status.canScan){
    btn.style.display="inline-block";btn.disabled=false;btn.style.opacity="1";btn.textContent="Scan Now";
    cd.style.display="none";
  } else {
    btn.style.display="inline-block";btn.disabled=true;btn.style.opacity="0.4";btn.textContent="Scan Now";
    cd.style.display="inline";
    const h=status.hoursRemaining||0;
    cd.textContent=h>1?"Next scan in "+h+"h":"Next scan in <1h";
    // Auto-refresh countdown every minute
    if(!window._scanTimer)window._scanTimer=setInterval(()=>{checkScanStatus();},60000);
  }
}
function checkScanStatus(){
  fetch("./api/scan/status").then(r=>r.ok?r.json():null).then(s=>{if(s)updateScanButton(s);}).catch(()=>{});
}
async function triggerScan(){
  const btn=$("scanBtn");
  btn.disabled=true;btn.textContent="Scanning...";btn.style.opacity="0.6";
  try{
    const r=await fetch("./api/config/trigger-scan",{method:"POST"});
    const d=await r.json();
    if(d.cooldown){updateScanButton(d);return;}
    if(d.error){btn.textContent="Error";setTimeout(()=>{checkScanStatus();},2000);return;}
    btn.textContent=d.alertsDetected+" alert"+(d.alertsDetected===1?"":"s")+" found";
    btn.style.opacity="1";
    // Refresh dashboard data
    fetch("./api/dashboard-data").then(r=>r.json()).then(d2=>{DATA=d2;$("lastUpdated").textContent="Last scan: just now";const active=document.querySelector("nav button.active");if(active&&tabs[active.dataset.tab])tabs[active.dataset.tab]();});
    // Re-check cooldown status after scan
    setTimeout(()=>{checkScanStatus();},3000);
  }catch(e){btn.textContent="Scan failed";setTimeout(()=>{checkScanStatus();},3000);}
}
checkScanStatus();
</script>
</body>
</html>`;

// ─── SETUP WIZARD HTML ──────────────────────────────────────────────────────

export const SETUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Setup</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52}
.wrap{max-width:640px;margin:0 auto;padding:32px 20px}
h1{font-size:24px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
h2{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:16px;color:#d4d8de}
.subtitle{color:#6b7280;font-size:14px;margin-bottom:32px}
.steps{display:flex;gap:8px;margin-bottom:32px}
.step-dot{width:32px;height:4px;background:#2a3038;border-radius:2px}
.step-dot.active{background:#5c6b3c}
.step-dot.done{background:#3d6b35}
.panel{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:24px;margin-bottom:16px}
label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px}
input[type=text],input[type=url],input[type=password]{width:100%;background:#0a0c0e;border:1px solid #2a3038;color:#d4d8de;padding:10px 12px;font-size:14px;border-radius:2px;outline:none}
input:focus{border-color:#5c6b3c}
.field{margin-bottom:16px}
.btn{display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;border:none;border-radius:2px}
.btn-primary{background:#5c6b3c;color:#d4d8de}
.btn-primary:hover{background:#7a8c52}
.btn-secondary{background:transparent;border:1px solid #2a3038;color:#6b7280}
.btn-secondary:hover{border-color:#5c6b3c;color:#d4d8de}
.btn-danger{background:#c23030;color:#fff}
.btn-sm{padding:6px 12px;font-size:11px}
.actions{display:flex;justify-content:space-between;margin-top:24px}
.competitor-card{background:#0a0c0e;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:12px}
.competitor-card .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.competitor-card .card-header strong{font-size:14px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-top:8px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
.msg-err{background:#c2303022;border:1px solid #c23030;color:#c23030}
.msg-info{background:#c4a74722;border:1px solid #c4a747;color:#c4a747}
.hidden{display:none}
.summary-item{padding:8px 0;border-bottom:1px solid #2a3038;font-size:14px}
.summary-item:last-child{border-bottom:none}
.summary-label{color:#6b7280;font-size:12px;text-transform:uppercase}
</style>
</head>
<body>
<div class="wrap">
<h1>Scope<span>Hound</span></h1>
<p class="subtitle">Configure your competitive intelligence agent</p>
<div class="steps"><div class="step-dot active" id="dot0"></div><div class="step-dot" id="dot1"></div><div class="step-dot" id="dot2"></div><div class="step-dot" id="dot3"></div></div>

<!-- STEP 0: Auth + Slack -->
<div id="step0">
<h2>Step 1: Connect</h2>
<div class="panel">
<div class="field"><label>Admin Token</label><input type="password" id="adminToken" placeholder="The ADMIN_TOKEN you set as a Cloudflare secret"><p style="font-size:12px;color:#6b7280;margin-top:4px">Set this in Cloudflare Dashboard → Worker → Settings → Variables → Secrets</p></div>
<div class="field"><label>Slack Webhook URL <span style="font-weight:400;text-transform:none;letter-spacing:0;color:#6b7280">(optional)</span></label><input type="url" id="slackUrl" placeholder="https://hooks.slack.com/services/..."><p style="font-size:12px;color:#6b7280;margin-top:4px">Create one at <a href="https://api.slack.com/messaging/webhooks" target="_blank">api.slack.com/messaging/webhooks</a></p></div>
<button class="btn btn-secondary btn-sm" onclick="testSlack()">Test Connection</button>
<div id="slackMsg"></div>
</div>
<div class="actions"><div></div><div style="display:flex;gap:8px;align-items:center"><button type="button" onclick="goStep(1)" style="font-size:12px;color:#6b7280;cursor:pointer;background:none;border:none;padding:0;font-family:inherit">Skip Slack</button><button class="btn btn-primary" onclick="validateStep0()">Next</button></div></div>
</div>

<!-- STEP 1: Competitors -->
<div id="step1" class="hidden">
<h2>Step 2: Competitors</h2>
<div id="compList"></div>
<button class="btn btn-secondary btn-sm" onclick="addComp()" style="margin-bottom:16px">+ Add Competitor</button>
<div class="actions"><button class="btn btn-secondary" onclick="goStep(0)">Back</button><button class="btn btn-primary" onclick="goStep(2)">Next</button></div>
</div>

<!-- STEP 2: Product Hunt -->
<div id="step2" class="hidden">
<h2>Step 3: Product Hunt (Optional)</h2>
<div class="panel">
<div class="field"><label>Topics to Monitor (comma-separated slugs)</label><input type="text" id="phTopicsSelf" placeholder="e.g. affiliate-marketing, developer-tools, email-marketing"></div>
<p style="font-size:12px;color:#6b7280;margin-top:4px">Lowercase, hyphenated PH topic slugs. No API token needed.</p>
</div>
<div class="actions"><button class="btn btn-secondary" onclick="goStep(1)">Back</button><button class="btn btn-primary" onclick="goStep(3)">Next</button></div>
</div>

<!-- STEP 3: Review + Launch -->
<div id="step3" class="hidden">
<h2>Step 4: Review + Launch</h2>
<div class="panel" id="summaryPanel"></div>
<div id="launchMsg"></div>
<div class="actions"><button class="btn btn-secondary" onclick="goStep(2)">Back</button><button class="btn btn-primary" id="launchBtn" onclick="launch()">Save & Run First Scan</button></div>
</div>
</div>

<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
let step=0;
const comps=[];
let existingConfig=null;
const base=location.origin;

function $(id){return document.getElementById(id)}
function validateStep0(){
  const tok=$("adminToken").value.trim();
  if(!tok){$("slackMsg").innerHTML='<div class="msg msg-err">Admin token is required.</div>';return;}
  goStep(1);
}
function goStep(n){
  $("step"+step).classList.add("hidden");
  step=n;
  $("step"+step).classList.remove("hidden");
  for(let i=0;i<4;i++){
    const d=$("dot"+i);
    d.classList.remove("active","done");
    if(i<n)d.classList.add("done");
    else if(i===n)d.classList.add("active");
  }
  if(n===3)renderSummary();
}

function addComp(data){
  const c=data||{name:"",website:"",pages:[],blogRss:"",_suggestions:[]};
  comps.push(c);
  renderComps();
}

function removeComp(i){comps.splice(i,1);renderComps();}

function renderComps(){
  let h="";
  for(let i=0;i<comps.length;i++){
    const c=comps[i];
    h+='<div class="competitor-card"><div class="card-header"><strong>Competitor '+(i+1)+'</strong><button class="btn btn-danger btn-sm" onclick="removeComp('+i+')">Remove</button></div>';
    h+='<div class="row"><div class="field"><label>Name</label><input type="text" value="'+escAttr(c.name)+'" onchange="comps['+i+'].name=this.value"></div><div class="field"><label>Website</label><div style="display:flex;gap:6px"><input type="url" value="'+escAttr(c.website)+'" onchange="comps['+i+'].website=this.value" placeholder="https://example.com" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="scanCompSelf('+i+')">Scan</button></div></div></div>';
    h+='<div class="field" style="margin-top:12px"><label style="color:#7a8c52">Pages to Monitor</label><p style="font-size:12px;color:#6b7280;margin-bottom:8px">Add specific pages you want to track for changes.</p>';
    h+='<div style="display:flex;gap:6px;margin-bottom:8px"><input type="url" id="addpage'+i+'" placeholder="https://competitor.com/pricing" style="flex:1;margin:0"><button class="btn btn-secondary btn-sm" onclick="addPageSelf('+i+')">Add</button></div>';
    h+='<div id="pageList'+i+'">';
    if(c.pages&&c.pages.length>0){
      c.pages.forEach(function(p,pi){
        h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:13px;border-bottom:1px solid #2a3038"><span style="color:#7a8c52;font-size:10px;text-transform:uppercase;background:#1a2010;padding:2px 6px;border-radius:3px;flex-shrink:0">'+escAttr(p.type)+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escAttr(p.url)+'</span><button class="btn btn-secondary btn-sm" style="padding:2px 6px;font-size:10px;color:#c55;border-color:#553333" onclick="removePageSelf('+i+','+pi+')">x</button></div>';
      });
    }
    h+='</div>';
    if(c._suggestions&&c._suggestions.length>0){
      h+='<div style="margin-top:8px"><label style="font-size:11px;color:#6b7280;text-transform:uppercase">Suggested pages</label>';
      c._suggestions.forEach(function(s,si){
        const already=c.pages&&c.pages.some(function(p){return p.url===s.url;});
        if(!already)h+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;color:#6b7280"><span style="flex:1">'+escAttr(s.label)+': '+escAttr(s.url)+'</span><button class="btn btn-secondary btn-sm" style="padding:1px 6px;font-size:10px" onclick="addSuggestionSelf('+i+','+si+')">+ Add</button></div>';
      });
      h+='</div>';
    }
    h+='</div>';
    h+='<div class="field" style="margin-top:8px"><label>Blog RSS</label><div style="display:flex;gap:6px"><input type="url" id="rss'+i+'" value="'+escAttr(c.blogRss)+'" onchange="comps['+i+'].blogRss=this.value" style="flex:1" placeholder="Optional"><button class="btn btn-secondary btn-sm" onclick="detectRss('+i+')">Detect</button></div></div></div>';
  }
  $("compList").innerHTML=h;
}

function escAttr(s){return(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}

function addPageSelf(i){
  const inp=$("addpage"+i);
  let u=(inp.value||"").trim();if(!u)return;
  if(!u.match(/^https?:/i))u="https://"+u;
  let type="general",label="Page";
  try{
    const path=new URL(u).pathname.toLowerCase();
    if(/(pricing|plans|price)/.test(path)){type="pricing";label="Pricing";}
    else if(/(features|product|solutions)/.test(path)){type="features";label="Features";}
    else if(/(blog|news|updates)/.test(path)){type="blog";label="Blog";}
    else if(/(careers|jobs)/.test(path)){type="careers";label="Careers";}
  }catch(e){} // Expected: URL parse for type detection
  if(!comps[i].pages)comps[i].pages=[];
  comps[i].pages.push({id:"p"+comps[i].pages.length,url:u,type:type,label:label});
  inp.value="";
  renderComps();
}
function removePageSelf(ci,pi){comps[ci].pages.splice(pi,1);renderComps();}
function addSuggestionSelf(ci,si){
  const s=comps[ci]._suggestions[si];
  if(!comps[ci].pages)comps[ci].pages=[];
  comps[ci].pages.push({id:"s"+comps[ci].pages.length,url:s.url,type:s.type,label:s.label});
  renderComps();
}
async function scanCompSelf(i){
  const tok=$("adminToken").value;
  if(!tok){alert("Enter admin token first");return;}
  const url=comps[i].website;if(!url)return;
  try{
    const r=await fetch(base+"/api/config/discover-pages",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":tok},body:JSON.stringify({url:url})});
    const d=await r.json();
    if(d.pages){
      comps[i]._suggestions=d.pages.filter(function(p){return p.label!=="Homepage";});
      if(!comps[i].pages)comps[i].pages=[];
      const hp=d.pages.find(function(p){return p.label==="Homepage";});
      if(hp&&!comps[i].pages.some(function(p){return p.url===hp.url;})){
        comps[i].pages.push({id:"home",url:hp.url,type:"general",label:"Homepage"});
      }
      if(d.pages.find(function(p){return p.rss;}))comps[i].blogRss=d.pages.find(function(p){return p.rss;}).rss;
      renderComps();
    }
  }catch(e){alert("Scan failed: "+e.message);}
}

async function detectRss(i){
  const tok=$("adminToken").value;
  if(!tok){alert("Enter admin token first");return;}
  const url=comps[i].website;if(!url)return;
  try{
    const r=await fetch(base+"/api/config/detect-rss",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":tok},body:JSON.stringify({url})});
    const d=await r.json();
    if(d.found){comps[i].blogRss=d.feedUrl;const el=$("rss"+i);if(el)el.value=d.feedUrl;}
    else{alert("No RSS feed found for "+url);}
  }catch(e){alert("Detection failed: "+e.message);}
}

async function testSlack(){
  const tok=$("adminToken").value;
  const url=$("slackUrl").value;
  if(!tok||!url){$("slackMsg").innerHTML='<div class="msg msg-err">Enter both fields first</div>';return;}
  try{
    const r=await fetch(base+"/api/config/test-slack",{method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":tok},body:JSON.stringify({webhookUrl:url})});
    const d=await r.json();
    $("slackMsg").innerHTML=d.success?'<div class="msg msg-ok">Connected! Check your Slack channel.</div>':'<div class="msg msg-err">'+esc(d.error||"Failed")+'</div>';
  }catch(e){$("slackMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}

function renderSummary(){
  let h='<div class="summary-item"><div class="summary-label">Competitors</div>'+comps.length+' configured</div>';
  h+='<div class="summary-item"><div class="summary-label">Slack</div>'+($("slackUrl").value?"Connected":"Not set")+'</div>';
  h+='<div class="summary-item"><div class="summary-label">Product Hunt</div>'+($("phTopicsSelf").value?$("phTopicsSelf").value:"Not configured")+'</div>';
  h+='<div class="summary-item"><div class="summary-label">Schedule</div>Daily at 9am UTC</div>';
  $("summaryPanel").innerHTML=h;
}

function buildCompetitors(){
  return comps.filter(c=>c.name&&c.website).map(c=>{
    const site=c.website.replace(/\\/+$/,"");
    let pages=c.pages||[];
    // Ensure homepage is always included
    if(!pages.some(function(p){return p.url===site||p.url===site+"/";})){
      pages.unshift({id:"home",url:site,type:"general",label:"Homepage"});
    }
    return{name:c.name,website:site,blogRss:c.blogRss||null,pages:pages};
  });
}

async function launch(){
  const tok=$("adminToken").value;
  if(!tok){$("launchMsg").innerHTML='<div class="msg msg-err">Admin token required</div>';return;}
  $("launchBtn").disabled=true;
  $("launchBtn").textContent="Saving...";
  try{
    const competitors=buildCompetitors();
    const phTopicStr=$("phTopicsSelf").value;
    const topics=phTopicStr?phTopicStr.split(",").map(s=>s.trim()).filter(Boolean).map(s=>({slug:s,name:s.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" ")})):[];
    const settings={slackWebhookUrl:$("slackUrl").value||null,productHuntTopics:topics};
    const h={"Content-Type":"application/json","X-Admin-Token":tok};
    const [r1,r2]=await Promise.all([fetch(base+"/api/config/competitors",{method:"POST",headers:h,body:JSON.stringify({competitors})}),fetch(base+"/api/config/settings",{method:"POST",headers:h,body:JSON.stringify(settings)})]);
    const d1=await r1.json(),d2=await r2.json();
    if(!d1.success||!d2.success){$("launchMsg").innerHTML='<div class="msg msg-err">Save failed: '+esc(d1.error||d2.error||"unknown")+'</div>';$("launchBtn").disabled=false;$("launchBtn").textContent="Save & Run First Scan";return;}
    $("launchBtn").textContent="Running first scan...";
    $("launchMsg").innerHTML='<div class="msg msg-info">Config saved. Running first scan (this may take a minute)...</div>';
    const r3=await fetch(base+"/api/config/trigger-scan",{method:"POST",headers:h});
    const d3=await r3.json();
    $("launchMsg").innerHTML='<div class="msg msg-ok">Done! Indexed '+competitors.length+' competitors. Redirecting to dashboard...</div>';
    setTimeout(()=>location.href=base+"/dashboard",2000);
  }catch(e){$("launchMsg").innerHTML='<div class="msg msg-err">Error: '+esc(e.message)+'</div>';$("launchBtn").disabled=false;$("launchBtn").textContent="Save & Run First Scan";}
}

// Load existing config on page load
(async function(){
  const tok=new URLSearchParams(location.search).get("token");
  if(!tok)return;
  $("adminToken").value=tok;
  history.replaceState(null,"",location.pathname);
  try{
    const r=await fetch(base+"/api/config?token="+tok);
    if(!r.ok)return;
    const d=await r.json();
    if(d.competitors&&d.competitors.length>0){
      for(const c of d.competitors){
        comps.push({name:c.name,website:c.website,pages:c.pages||[],blogRss:c.blogRss||"",_suggestions:[]});
      }
      renderComps();
    }
    if(d.settings){
      if(d.settings.slackWebhookUrl)$("slackUrl").value=d.settings.slackWebhookUrl;
      if(d.settings.productHuntTopics&&d.settings.productHuntTopics.length)$("phTopicsSelf").value=d.settings.productHuntTopics.map(t=>t.slug).join(", ");
    }
  }catch(e){} // Expected: config fetch may fail
})();

if(comps.length===0)addComp();
</script>
</body>
</html>`;

// ─── SIGN-IN HTML (hosted mode) ──────────────────────────────────────────────

export const SIGNIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Sign In</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:40px 32px;width:100%;max-width:380px;text-align:center}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:32px}
.btn-google{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;background:#fff;color:#333;border:none;border-radius:2px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:12px;text-decoration:none}
.btn-google:hover{background:#f0f0f0}
.btn-apple{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:12px;background:#000;color:#fff;border:1px solid #333;border-radius:2px;font-size:14px;font-weight:600;cursor:default;opacity:0.4;position:relative;margin-bottom:24px}
.btn-apple .soon{position:absolute;right:12px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280}
.footer{font-size:12px;color:#6b7280}
.footer a{color:#7a8c52}
</style>
</head>
<body>
<div class="card">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Sign in to your intelligence dashboard</p>
<a href="/auth/google" class="btn-google"><svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continue with Google</a>
<div class="btn-apple"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.32 2.32-1.95 4.27-3.74 4.25z"/></svg>Continue with Apple<span class="soon">Soon</span></div>
<div class="footer">Want full control? <a href="https://github.com/ZeroLupo/scopehound">Self-host for free</a></div>
</div>
</body>
</html>`;

// ─── BILLING HTML (hosted mode) ─────────────────────────────────────────────

export const BILLING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Billing</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52;text-decoration:none}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.wrap{max-width:900px;margin:0 auto;padding:32px 24px}
h2{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:20px}
.current{background:#12161a;border:1px solid #5c6b3c;border-radius:2px;padding:20px;margin-bottom:32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.current-plan{font-size:18px;font-weight:700;text-transform:uppercase}
.current-status{font-size:12px;color:#3d6b35;text-transform:uppercase;letter-spacing:0.05em}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.plan{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px;display:flex;flex-direction:column}
.plan.active{border-color:#5c6b3c}
.plan-name{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px}
.plan-price{font-size:24px;font-weight:700;margin-bottom:4px}
.plan-price .mo{font-size:12px;color:#6b7280;font-weight:400}
.plan-features{list-style:none;margin:12px 0;flex:1}
.plan-features li{font-size:12px;color:#6b7280;padding:3px 0;border-bottom:1px solid #1a1f25}
.plan-features li:last-child{border-bottom:none}
.btn{display:block;width:100%;padding:10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;text-align:center;cursor:pointer;border:none;border-radius:2px}
.btn-primary{background:#5c6b3c;color:#d4d8de}
.btn-primary:hover{background:#7a8c52}
.btn-secondary{background:transparent;border:1px solid #2a3038;color:#6b7280}
.btn-secondary:hover{border-color:#5c6b3c;color:#d4d8de}
.btn-current{background:#1a1f25;color:#6b7280;cursor:default}
.manage{text-align:center;margin-top:24px;font-size:13px;color:#6b7280}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-bottom:16px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
@media(max-width:700px){.grid{grid-template-columns:1fr 1fr !important}.current{flex-direction:column;align-items:flex-start}}
@media(max-width:480px){.grid{grid-template-columns:1fr !important}}
</style>
</head>
<body>
<header><h1>Scope<span>Hound</span></h1><div style="display:flex;align-items:center;gap:16px"><span id="userBar" style="font-size:12px;color:#6b7280"></span><a href="/dashboard" style="font-size:12px">Dashboard</a></div></header>
<div id="activatingOverlay" style="display:none;position:fixed;inset:0;background:#0a0c0e;z-index:9999;align-items:center;justify-content:center;flex-direction:column">
<div style="font-size:24px;font-weight:700;color:#d4d8de;margin-bottom:12px">Activating your subscription<span id="loadDots"></span></div>
<div style="font-size:14px;color:#6b7280;margin-bottom:24px" id="activatingStatus">Confirming payment with Stripe...</div>
<div style="width:200px;height:4px;background:#1e2328;border-radius:2px;overflow:hidden"><div id="activatingBar" style="width:0%;height:100%;background:#5c6b3c;border-radius:2px;transition:width 0.5s ease"></div></div>
</div>
<div class="wrap">
<div id="successMsg"></div>
<div class="current" id="currentPlan"><div><div class="current-plan" id="planName">Loading...</div><div class="current-status" id="planStatus"></div></div></div>
<h2>Plans</h2>
<div style="text-align:center;margin-bottom:16px;display:flex;align-items:center;justify-content:center;gap:12px"><span id="monthlyLabel" style="font-size:12px;font-weight:600;color:#d4d8de;cursor:pointer" onclick="document.getElementById('billingToggle').checked=false;toggleBilling()">Monthly</span><label style="display:inline-block;vertical-align:middle;width:40px;height:22px;position:relative;cursor:pointer" onclick="const cb=document.getElementById('billingToggle');cb.checked=!cb.checked;toggleBilling()"><input type="checkbox" id="billingToggle" style="opacity:0;position:absolute;width:0;height:0;pointer-events:none"><span style="position:absolute;inset:0;background:#2a3038;border-radius:11px;transition:0.3s"></span><span id="toggleDot" style="position:absolute;top:3px;left:3px;width:16px;height:16px;background:#d4d8de;border-radius:50%;transition:0.3s"></span></label><span id="annualLabel" style="font-size:12px;color:#6b7280;cursor:pointer" onclick="document.getElementById('billingToggle').checked=true;toggleBilling()">Annual <span style="color:#5c6b3c;font-weight:700">Save 17%</span></span></div>
<div class="grid" style="grid-template-columns:repeat(3,1fr)">
<div class="plan" data-tier="scout"><div class="plan-name">Scout</div><div class="plan-price" data-monthly="29" data-annual="290">$29<span class="mo">/mo</span></div><ul class="plan-features"><li>3 competitors</li><li>6 pages</li><li>Manual scans only</li><li>30-day history</li><li>Dashboard + Slack alerts</li></ul><button class="btn btn-primary" id="btn-scout" onclick="checkout('scout')">Subscribe</button></div>
<div class="plan" data-tier="operator" style="border-color:#5c6b3c;position:relative"><div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#5c6b3c;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:2px 10px;border-radius:2px">Recommended</div><div class="plan-name">Operator</div><div class="plan-price" data-monthly="79" data-annual="790">$79<span class="mo">/mo</span></div><ul class="plan-features"><li>15 competitors</li><li>60 pages</li><li>Daily automated scans</li><li>1-year history</li><li>AI competitor discovery</li><li>RSS/blog monitoring</li><li>/scan + /ads commands</li></ul><button class="btn btn-primary" id="btn-operator" onclick="checkout('operator')">Subscribe</button></div>
<div class="plan" data-tier="command"><div class="plan-name">Command</div><div class="plan-price" data-monthly="199" data-annual="1990">$199<span class="mo">/mo</span></div><ul class="plan-features"><li>50 competitors</li><li>400 pages</li><li>Daily automated scans</li><li>Unlimited history</li><li>Everything in Operator</li><li>Priority scan queue</li><li>Competitor Radar (soon)</li></ul><button class="btn btn-primary" id="btn-command" onclick="checkout('command')">Subscribe</button></div>
</div>
<div class="manage" id="manageSection" style="display:none"><a href="#" onclick="manageSubscription();return false">Manage subscription on Stripe</a></div>
</div>
<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
let billingPeriod="monthly";
function toggleBilling(){
  const on=document.getElementById("billingToggle").checked;
  billingPeriod=on?"annual":"monthly";
  document.getElementById("toggleDot").style.left=on?"21px":"3px";
  const track=document.getElementById("toggleDot").parentElement.querySelector("span");
  if(track)track.style.background=on?"#5c6b3c":"#2a3038";
  document.getElementById("monthlyLabel").style.color=on?"#6b7280":"#d4d8de";
  document.getElementById("monthlyLabel").style.fontWeight=on?"400":"600";
  document.getElementById("annualLabel").style.color=on?"#d4d8de":"#6b7280";
  document.getElementById("annualLabel").style.fontWeight=on?"600":"400";
  document.querySelectorAll(".plan-price").forEach(el=>{
    const m=el.dataset.monthly,a=el.dataset.annual;
    if(on){el.innerHTML="$"+a+'<span class="mo">/yr</span>';}
    else{el.innerHTML="$"+m+'<span class="mo">/mo</span>';}
  });
}
async function loadProfile(){
  try{const r=await fetch("/api/user/profile");if(!r.ok)return;const u=await r.json();
  if(u.email){document.getElementById("userBar").innerHTML=esc(u.email)+' &middot; <a href="/auth/logout" style="color:#c23030;text-decoration:none">Sign out</a>';}
  document.getElementById("planName").textContent=u.tier?u.tier.toUpperCase()+" PLAN":"NO PLAN";
  document.getElementById("planStatus").textContent=u.subscriptionStatus==="active"?"Active":u.subscriptionStatus||"Choose a plan to get started";
  const tier=u.tier;
  const tierOrder=["scout","recon","operator","command","strategic"];
  document.querySelectorAll(".plan").forEach(p=>{const t=p.dataset.tier;const btn=p.querySelector("button");
  if(!tier){btn.textContent="Subscribe";btn.className="btn btn-primary";btn.onclick=function(){checkout(t);};}
  else if(t===tier){p.classList.add("active");btn.className="btn btn-current";btn.textContent="Current Plan";btn.onclick=null;}
  else if(tierOrder.indexOf(t)>tierOrder.indexOf(tier)){btn.textContent="Upgrade";btn.className="btn btn-primary";}
  else{btn.textContent="Downgrade";btn.className="btn btn-secondary";}});
  if(u.stripeCustomerId)document.getElementById("manageSection").style.display="block";
  }catch(e){} // Expected: billing profile fetch may fail
  if(new URLSearchParams(location.search).get("success")){waitForSubscription();return;}
}
async function waitForSubscription(){
  const overlay=document.getElementById("activatingOverlay");
  overlay.style.display="flex";
  const bar=document.getElementById("activatingBar");
  const status=document.getElementById("activatingStatus");
  const dots=document.getElementById("loadDots");
  let dotCount=0;
  const dotInterval=setInterval(()=>{dotCount=(dotCount+1)%4;dots.textContent=".".repeat(dotCount);},400);
  const steps=["Confirming payment with Stripe...","Setting up your account...","Almost ready..."];
  for(let i=0;i<20;i++){
    bar.style.width=Math.min(5+i*4.5,95)+"%";
    if(i<steps.length)status.textContent=steps[i];
    else if(i>=6)status.textContent="Still working, hang tight...";
    await new Promise(r=>setTimeout(r,1500));
    try{const r=await fetch("/api/user/profile");if(!r.ok)continue;const u=await r.json();
    if(u.subscriptionStatus==="active"){bar.style.width="100%";status.textContent="You're all set!";clearInterval(dotInterval);dots.textContent="";await new Promise(r=>setTimeout(r,600));window.location.href="/setup";return;}}catch(e){} // Expected: polling retry
  }
  clearInterval(dotInterval);dots.textContent="";
  bar.style.width="100%";bar.style.background="#c44";
  status.textContent="Taking longer than expected. Please refresh the page.";
}
async function checkout(tier){try{const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tier,period:billingPeriod})});const d=await r.json();if(d.url)location.href=d.url;else alert(d.error||"Failed");}catch(e){alert(e.message);}}
async function manageSubscription(){try{const r=await fetch("/api/billing/portal",{method:"POST"});const d=await r.json();if(d.url)location.href=d.url;else alert(d.error||"Failed");}catch(e){alert(e.message);}}
loadProfile();
</script>
</body>
</html>`;

// ─── HOSTED SETUP WIZARD HTML ─────────────────────────────────────────────────

export const HOSTED_SETUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Setup</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52;text-decoration:none}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.wrap{max-width:700px;margin:0 auto;padding:32px 24px}
h2{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px}
.subtitle{font-size:13px;color:#6b7280;margin-bottom:20px}
.steps{display:flex;gap:8px;margin-bottom:32px}
.step-tab{flex:1;padding:10px;text-align:center;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:#12161a;border:1px solid #2a3038;border-radius:2px;color:#6b7280;cursor:default}
.step-tab.active{border-color:#5c6b3c;color:#d4d8de}
.step-tab.done{border-color:#3d6b35;color:#3d6b35}
.panel{display:none}
.panel.active{display:block}
label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px}
input[type="text"],input[type="url"]{width:100%;padding:10px 12px;background:#12161a;border:1px solid #2a3038;border-radius:2px;color:#d4d8de;font-size:14px;margin-bottom:12px}
input:focus{outline:none;border-color:#5c6b3c}
.btn{display:inline-block;padding:10px 20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;text-align:center;cursor:pointer;border:none;border-radius:2px}
.btn-primary{background:#5c6b3c;color:#d4d8de}
.btn-primary:hover{background:#7a8c52}
.btn-secondary{background:transparent;border:1px solid #2a3038;color:#6b7280}
.btn-secondary:hover{border-color:#5c6b3c;color:#d4d8de}
.btn-sm{padding:6px 14px;font-size:11px}
.btn:disabled{opacity:0.4;cursor:not-allowed}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-bottom:12px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
.msg-err{background:#6b353522;border:1px solid #6b3535;color:#c55}
.comp-card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:12px;position:relative}
.comp-card .remove{position:absolute;top:12px;right:12px;background:none;border:none;color:#6b7280;cursor:pointer;font-size:16px}
.comp-card .remove:hover{color:#c55}
.pages-list{margin:8px 0 0}
.pages-list label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:400;text-transform:none;letter-spacing:0;color:#d4d8de;margin-bottom:4px;cursor:pointer}
.pages-list input[type="checkbox"]{width:auto;margin:0;accent-color:#5c6b3c}
.pages-list .page-url{color:#6b7280;font-size:11px;margin-left:4px}
.custom-page{display:flex;gap:8px;margin-top:8px}
.custom-page input{flex:1;margin-bottom:0}
.tier-info{font-size:12px;color:#6b7280;margin-bottom:16px}
.tier-info strong{color:#5c6b3c}
.scanning{color:#6b7280;font-size:13px;font-style:italic}
.helper{font-size:12px;color:#6b7280;margin-bottom:16px}
.helper a{color:#7a8c52}
.review-item{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1f25;font-size:14px}
.review-label{color:#6b7280}
.nav-btns{display:flex;justify-content:space-between;margin-top:24px}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.scan-progress{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-top:12px}
.scan-progress .scan-step{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;color:#6b7280;transition:color .3s}
.scan-progress .scan-step.active{color:#7a8c52}
.scan-progress .scan-step.done{color:#5c6b3c}
.scan-progress .scan-step .dot{width:6px;height:6px;border-radius:50%;background:#2a3038;flex-shrink:0;transition:background .3s}
.scan-progress .scan-step.active .dot{background:#7a8c52;animation:pulse 1.2s infinite}
.scan-progress .scan-step.done .dot{background:#5c6b3c}
.ai-discover{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:20px}
.ai-discover h3{font-size:14px;margin-bottom:4px;color:#d4d8de}
.ai-discover .ai-desc{font-size:12px;color:#6b7280;margin-bottom:12px}
.ai-discover .ai-input{display:flex;gap:8px}
.ai-discover .ai-input input{flex:1;margin:0}
.ai-results{margin-top:12px}
.ai-result{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid #2a3038;border-radius:2px;margin-bottom:6px;cursor:pointer;transition:border-color .2s}
.ai-result:hover{border-color:#5c6b3c}
.ai-result.selected{border-color:#7a8c52;background:#5c6b3c11}
.ai-result input[type="checkbox"]{margin-top:3px;accent-color:#5c6b3c}
.ai-result .ai-name{font-size:14px;font-weight:600;color:#d4d8de}
.ai-result .ai-url{font-size:11px;color:#6b7280}
.ai-result .ai-reason{font-size:12px;color:#6b7280;margin-top:2px}
.ai-or{text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;margin:16px 0;position:relative}
.ai-or::before,.ai-or::after{content:"";position:absolute;top:50%;width:calc(50% - 20px);height:1px;background:#2a3038}
.ai-or::before{left:0}
.ai-or::after{right:0}
@keyframes aiThink{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ai-thinking{padding:24px;text-align:center}
.ai-thinking .ai-brain{font-size:13px;color:#7a8c52;margin-bottom:8px}
.ai-thinking .ai-bar{height:3px;border-radius:2px;background:linear-gradient(90deg,#12161a 0%,#5c6b3c 50%,#12161a 100%);background-size:200% 100%;animation:aiThink 1.5s ease-in-out infinite}
.ai-thinking .ai-status{font-size:12px;color:#6b7280;margin-top:8px}
@media(max-width:600px){.steps{flex-direction:column}}
</style>
</head>
<body>
<header><h1>Scope<span>Hound</span></h1><div style="display:flex;align-items:center;gap:16px"><span id="userBar" style="font-size:12px;color:#6b7280"></span><a href="/billing" style="font-size:12px">Billing</a></div></header>
<div class="wrap">
<div class="steps">
<div class="step-tab active" id="tab1">1. Slack</div>
<div class="step-tab" id="tab2">2. Competitors</div>
<div class="step-tab" id="tab3">3. Launch</div>
</div>

<!-- Step 1: Slack -->
<div class="panel active" id="panel1">
<h2>Connect Slack</h2>
<p class="subtitle">ScopeHound delivers your daily competitive intel briefing to Slack. One click to connect.</p>
<div id="slackMsg"></div>
<div id="slackConnected" style="display:none">
<div class="msg msg-ok" id="slackStatus">Connected to Slack!</div>
<div style="margin-top:8px"><a href="/auth/slack" style="font-size:12px;color:#6b7280">Change channel or reconnect</a></div>
</div>
<div id="slackNotConnected">
<div style="margin:24px 0;text-align:center">
<a href="/auth/slack" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:10px;padding:14px 28px;font-size:14px">
<svg width="20" height="20" viewBox="0 0 123 123" fill="none"><path d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9v12.9zm6.5 0a12.9 12.9 0 1 1 25.8 0v32.3a12.9 12.9 0 1 1-25.8 0V77.6z" fill="#E01E5A"/><path d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9H45.2zm0 6.5a12.9 12.9 0 1 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8h32.3z" fill="#36C5F0"/><path d="M97.2 45.2a12.9 12.9 0 1 1 12.9 12.9H97.2V45.2zm-6.5 0a12.9 12.9 0 1 1-25.8 0V12.9a12.9 12.9 0 1 1 25.8 0v32.3z" fill="#2EB67D"/><path d="M77.8 97.2a12.9 12.9 0 1 1-12.9 12.9V97.2h12.9zm0-6.5a12.9 12.9 0 1 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8H77.8z" fill="#ECB22E"/></svg>
Add to Slack
</a>
</div>
<details style="margin-top:16px">
<summary style="font-size:12px;color:#6b7280;cursor:pointer">I already have a webhook URL</summary>
<div style="margin-top:8px">
<input type="url" id="slackUrl" placeholder="https://hooks.slack.com/services/...">
<button class="btn btn-secondary btn-sm" onclick="testSlack()" style="margin-top:4px">Test & Connect</button>
</div>
</details>
</div>
<div class="nav-btns">
<div></div>
<div style="display:flex;gap:8px;align-items:center">
<button type="button" onclick="skipSlack()" style="font-size:12px;color:#6b7280;cursor:pointer;background:none;border:none;padding:0;font-family:inherit" id="skipLink">Skip for now</button>
<button class="btn btn-primary" id="slackNext" onclick="goStep(2)">Next</button>
</div>
</div>
</div>

<!-- Step 2: Competitors -->
<div class="panel" id="panel2">
<h2>Add Competitors</h2>
<div class="tier-info" id="tierInfo"></div>
<div class="ai-discover" id="aiDiscover">
<h3>Find My Competitors</h3>
<p class="ai-desc">Enter your company URL and our AI will identify your competitors automatically.</p>
<div class="ai-input">
<input type="url" id="myCompanyUrl" placeholder="yourcompany.com">
<button class="btn btn-primary btn-sm" onclick="findCompetitors()">Find Competitors</button>
</div>
<details style="margin-top:12px;cursor:pointer">
<summary style="font-size:13px;color:#7a8c52;font-weight:600">Know your competitors? Add them for better results</summary>
<p style="font-size:12px;color:#6b7280;margin:8px 0 6px">Providing 1-2 known competitors helps our AI find more relevant matches in your niche.</p>
<div style="display:flex;gap:8px;margin-bottom:8px">
<input type="url" id="seedComp1" placeholder="competitor1.com" style="flex:1;padding:8px 12px;border:1px solid #374151;border-radius:8px;background:#1a1a2e;color:#e5e7eb;font-size:13px">
<input type="url" id="seedComp2" placeholder="competitor2.com" style="flex:1;padding:8px 12px;border:1px solid #374151;border-radius:8px;background:#1a1a2e;color:#e5e7eb;font-size:13px">
</div>
</details>
<div id="aiResults"></div>
</div>
<div class="ai-or">or add manually</div>
<div id="compList"></div>
<button class="btn btn-secondary btn-sm" onclick="addCompetitor()" id="addCompBtn">+ Add Competitor</button>
<div id="radarSection" style="margin-top:24px;display:none">
<h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;color:#d4d8de">Product Hunt Monitoring</h3>
<p class="subtitle" style="margin-bottom:12px">Monitor PH topics for new product launches in your space.</p>
<div id="phTopics" style="margin-bottom:12px"></div>
<button class="btn btn-secondary btn-sm" id="suggestPHBtn" onclick="suggestPH()" style="display:none">Suggest Topics</button>
<div id="phMsg"></div>
<h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin:20px 0 8px;color:#d4d8de">Reddit Radar</h3>
<p class="subtitle" style="margin-bottom:12px">Monitor subreddits for new competitor mentions.</p>
<div id="radarSubs" style="margin-bottom:12px"></div>
<button class="btn btn-secondary btn-sm" id="suggestSubsBtn" onclick="suggestSubs()" style="display:none">Suggest Subreddits</button>
<div id="radarMsg"></div>
</div>
<div class="nav-btns">
<button class="btn btn-secondary" onclick="goStep(1)">Back</button>
<button class="btn btn-primary" id="compNext" onclick="goStep(3)">Next</button>
</div>
</div>

<!-- Step 3: Review & Launch -->
<div class="panel" id="panel3">
<h2>Review & Launch</h2>
<p class="subtitle">Confirm your setup and launch your first scan.</p>
<div id="reviewSummary"></div>
<div id="launchMsg"></div>
<div class="nav-btns">
<button class="btn btn-secondary" onclick="goStep(2)">Back</button>
<button class="btn btn-primary" id="launchBtn" onclick="launch()">Save & Launch First Scan</button>
</div>
</div>
</div>
<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
let currentStep=1,slackVerified=false,slackSkipped=false,competitors=[];
async function loadUserInfo(){
  try{const r=await fetch("/api/user/profile");if(r.ok){const u=await r.json();
  const t=u.tier||"scout";const limits={scout:{c:3,p:6,ppc:4},recon:{c:3,p:6,ppc:4},operator:{c:15,p:60,ppc:4},command:{c:50,p:400,ppc:8},strategic:{c:50,p:400,ppc:8}};
  const l=limits[t]||limits.scout;
  document.getElementById("tierInfo").innerHTML="You can add up to <strong>"+l.c+" competitors</strong> on your "+t.charAt(0).toUpperCase()+t.slice(1)+" plan.";
  window._tierLimits=l;window._tier=t;
  // Hide AI discovery for Scout (not available on their plan)
  if(t==="scout"||t==="recon"){const ai=document.getElementById("aiDiscover");if(ai){ai.innerHTML='<div style="padding:16px;text-align:center"><p style="font-size:13px;color:#6b7280;margin-bottom:8px">AI competitor discovery is available on the Operator plan.</p><a href="/billing" style="font-size:12px">Upgrade to unlock</a></div>';}}
  if(u.email){document.getElementById("userBar").innerHTML=esc(u.email)+' &middot; <a href="/auth/logout" style="color:#c23030;text-decoration:none">Sign out</a>';}}}catch(e){} // Expected: profile fetch may fail
  // Check if Slack was just connected via OAuth
  if(new URLSearchParams(location.search).get("slack")==="connected"){
    slackVerified=true;
    document.getElementById("slackConnected").style.display="block";
    document.getElementById("slackNotConnected").style.display="none";
    document.getElementById("slackNext").disabled=false;
    document.getElementById("skipLink").style.display="none";
    document.getElementById("slackStatus").textContent="Connected to Slack!";
    setTimeout(function(){goStep(2);},100);
  }
  // Load existing config (Slack + competitors)
  try{const r=await fetch("/api/config");if(r.ok){const c=await r.json();
  if(c.settings&&c.settings.slackWebhookUrl){
    slackVerified=true;
    document.getElementById("slackConnected").style.display="block";
    document.getElementById("slackNotConnected").style.display="none";
    document.getElementById("slackNext").disabled=false;
    document.getElementById("skipLink").style.display="none";
    const ch=c.settings.slackChannel;
    document.getElementById("slackStatus").textContent="Connected to Slack"+(ch?" (#"+ch+")":"")+"!";
  }
  if(c.competitors&&c.competitors.length>0){
    competitors=c.competitors.map(comp=>({name:comp.name,website:comp.website,blogRss:comp.blogRss||null,pages:(comp.pages||[]).map(function(p){return{id:p.id||p.type+"-0",url:p.url,type:p.type,label:p.label,preview:p.preview||null};}),_discovered:[]
    }));renderCompetitors();
  }
  if(c.settings&&c.settings.productHuntTopics&&c.settings.productHuntTopics.length>0){
    window._phTopics=c.settings.productHuntTopics;
    renderPHTopics(c.settings.productHuntTopics.map(t=>({slug:t.slug,name:t.name,reason:t.slug})));
  }
  if(c.settings&&c.settings.radarSubreddits&&c.settings.radarSubreddits.length>0){
    window._radarSubreddits=c.settings.radarSubreddits.map(s=>s.toLowerCase().startsWith("r/")?s.slice(2):s);
    renderRadarSubs(window._radarSubreddits.map(s=>({name:s,reason:"Configured"})));
  }
  // Show PH/Reddit section if any data exists or competitors are loaded
  if(window._phTopics.length>0||window._radarSubreddits.length>0||(c.competitors&&c.competitors.length>0)){
    showRadarSection();
  }
  // Auto-advance past Slack if already connected
  if(slackVerified)goStep(2);
  }}catch(e){} // Expected: setup config fetch may fail
}
function goStep(n){
  if(n===2&&!slackVerified&&!slackSkipped){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">Connect Slack or click Skip for now.</div>';return;}
  if(n===3&&competitors.length===0){alert("Add at least one competitor.");return;}
  if(n===3){
    // Validate per-company page limits
    const maxPpc=window._tierLimits?window._tierLimits.ppc:4;
    document.querySelectorAll(".page-limit-err").forEach(e=>e.remove());
    for(let i=0;i<competitors.length;i++){
      if(competitors[i].pages.length>maxPpc){
        const card=document.querySelectorAll(".comp-card")[i];
        if(card){
          const err=document.createElement("div");
          err.className="page-limit-err";
          err.style="color:#c23030;font-size:12px;margin-top:4px;padding:4px 8px;background:#1a0505;border:1px solid #3a1515;border-radius:2px";
          err.textContent="Too many pages selected ("+competitors[i].pages.length+"/"+maxPpc+" max). Uncheck some pages.";
          card.querySelector(".pages-list").appendChild(err);
          card.scrollIntoView({behavior:"smooth",block:"center"});
        }
        return;
      }
    }
  }
  currentStep=n;
  document.querySelectorAll(".panel").forEach((p,i)=>{p.classList.toggle("active",i===n-1);});
  document.querySelectorAll(".step-tab").forEach((t,i)=>{t.className="step-tab"+(i===n-1?" active":i<n-1?" done":"");});
  if(n===3){document.getElementById("launchMsg").innerHTML="";renderReview();}
}
function skipSlack(){slackSkipped=true;goStep(2);}
async function testSlack(){
  const u=document.getElementById("slackUrl").value.trim();
  if(!u){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">Enter a webhook URL.</div>';return;}
  document.getElementById("slackMsg").innerHTML='<div class="msg">Testing...</div>';
  try{const r=await fetch("/api/config/test-slack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({webhookUrl:u})});
  const d=await r.json();
  if(d.success){slackVerified=true;document.getElementById("slackNext").disabled=false;
  document.getElementById("slackConnected").style.display="block";document.getElementById("slackNotConnected").style.display="none";
  document.getElementById("slackStatus").textContent="Connected! Check your Slack channel.";
  document.getElementById("skipLink").style.display="none";
  // Save webhook URL
  await fetch("/api/config/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slackWebhookUrl:u})});
  }else{document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">'+esc(d.error||"Failed to connect.")+'</div>';}
  }catch(e){document.getElementById("slackMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}
let aiSuggestions=[];
async function findCompetitors(){
  const el=document.getElementById("aiResults");
  let u=document.getElementById("myCompanyUrl").value.trim();
  if(!u){el.innerHTML='<div class="msg msg-err">Enter your company URL.</div>';return;}
  if(!u.match(/^https?:/i))u="https://"+u;
  document.getElementById("myCompanyUrl").value=u;
  el.innerHTML='<div class="ai-thinking"><div class="ai-brain">Analyzing your website...</div><div class="ai-bar"></div><div class="ai-status">Identifying industry and finding competitors</div></div>';
  // Animate status text
  const statuses=["Reading your homepage...","Checking pricing and features pages...","Extracting product metadata...","Generating search queries...","Searching the web for competitors...","Analyzing and categorizing results...","Ranking by relevance..."];
  let si=0;
  const statusInterval=setInterval(()=>{
    si=(si+1)%statuses.length;
    const s=el.querySelector(".ai-status");if(s)s.textContent=statuses[si];
  },2000);
  try{
    const seeds=[(document.getElementById("seedComp1")||{}).value,(document.getElementById("seedComp2")||{}).value].map(s=>(s||"").trim()).filter(Boolean);
    const r=await fetch("/api/config/discover-competitors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u,seeds:seeds})});
    clearInterval(statusInterval);
    const d=await r.json();
    if(d.error){el.innerHTML='<div class="msg msg-err">'+esc(d.error)+'</div>';return;}
    aiSuggestions=d.competitors||[];
    // Store product meta for radar use
    if(d._productMeta)window._productMeta=d._productMeta;
    if(aiSuggestions.length===0){el.innerHTML='<div class="msg">No competitors found. Try adding them manually below.</div>';return;}
    const overlapColors={direct:"#7a8c52",adjacent:"#c9952e",broader_platform:"#6b7280"};
    const overlapLabels={direct:"Direct",adjacent:"Adjacent",broader_platform:"Broader Platform"};
    const ind=esc((d.industry||"").charAt(0).toUpperCase()+(d.industry||"").slice(1));
    let html='<div style="font-size:12px;color:#6b7280;margin:12px 0 8px">Industry: <strong style="color:#7a8c52">'+ind+'</strong></div>';
    if(d.market_summary)html+='<div style="font-size:12px;color:#9ca3af;margin:0 0 12px;line-height:1.5">'+esc(d.market_summary)+'</div>';
    html+='<div style="font-size:12px;color:#6b7280;margin:0 0 8px">Select competitors to add:</div>';
    html+=aiSuggestions.map((c,i)=>{
      const badge=c.overlap&&overlapLabels[c.overlap]?'<span style="font-size:10px;background:'+overlapColors[c.overlap]+'22;color:'+overlapColors[c.overlap]+';padding:2px 6px;border-radius:4px;margin-left:8px">'+overlapLabels[c.overlap]+'</span>':"";
      const score=typeof c.match_score==="number"?c.match_score:0;
      const scoreColor=score>=75?"#7a8c52":score>=50?"#c9952e":"#6b7280";
      const scoreBadge=score>0?'<span style="font-size:11px;font-weight:600;color:'+scoreColor+';margin-left:8px" title="Competitive overlap score">'+score+'%</span>':"";
      return '<div class="ai-result" onclick="toggleAiResult(event,this,'+i+')"><input type="checkbox" id="aicheck'+i+'" onchange="onAiCheck('+i+')"><div><div class="ai-name">'+esc(c.name)+scoreBadge+badge+'</div><div class="ai-url">'+esc(c.url)+'</div><div class="ai-reason">'+esc(c.reason||c.description||"")+'</div></div></div>';
    }).join("");
    html+='<div style="margin-top:12px;display:flex;align-items:center;gap:12px"><button class="btn btn-primary btn-sm" onclick="addSelectedAi()" id="addAiBtn" disabled>Add Selected Competitors</button><a href="#" onclick="toggleSelectAllAi(event)" id="selectAllLink" style="font-size:12px;color:#5c6b3c">Select All</a></div>';
    el.innerHTML=html;
    // Trigger radar subreddit suggestions for Command users
    showRadarSection();
  }catch(e){clearInterval(statusInterval);el.innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}
function toggleAiResult(ev,el,idx){
  if(ev.target.tagName==="INPUT")return;
  const cb=document.getElementById("aicheck"+idx);cb.checked=!cb.checked;
  el.classList.toggle("selected",cb.checked);
  const any=aiSuggestions.some((_,i)=>document.getElementById("aicheck"+i)?.checked);
  document.getElementById("addAiBtn").disabled=!any;
  updateSelectAllLabel();
}
function toggleSelectAllAi(ev){
  ev.preventDefault();
  let allChecked=aiSuggestions.every(function(_,i){const cb=document.getElementById("aicheck"+i);return cb&&cb.checked;});
  aiSuggestions.forEach(function(_,i){
    const cb=document.getElementById("aicheck"+i);if(!cb)return;
    cb.checked=!allChecked;
    cb.closest(".ai-result").classList.toggle("selected",cb.checked);
  });
  document.getElementById("addAiBtn").disabled=allChecked;
  document.getElementById("selectAllLink").textContent=allChecked?"Select All":"Deselect All";
}
function updateSelectAllLabel(){
  const allChecked=aiSuggestions.every(function(_,i){const cb=document.getElementById("aicheck"+i);return cb&&cb.checked;});
  const link=document.getElementById("selectAllLink");
  if(link)link.textContent=allChecked?"Deselect All":"Select All";
}
function onAiCheck(idx){
  const cb=document.getElementById("aicheck"+idx);
  cb.closest(".ai-result").classList.toggle("selected",cb.checked);
  const any=aiSuggestions.some((_,i)=>document.getElementById("aicheck"+i)?.checked);
  document.getElementById("addAiBtn").disabled=!any;
  updateSelectAllLabel();
}
async function addSelectedAi(){
  const selected=aiSuggestions.filter((_,i)=>document.getElementById("aicheck"+i)?.checked);
  const lim=window._tierLimits;
  const remaining=lim?(lim.c-competitors.length):99;
  if(selected.length>remaining){alert("You can only add "+remaining+" more competitor"+(remaining===1?"":"s")+" on your plan.");return;}
  const btn=document.getElementById("addAiBtn");
  btn.disabled=true;btn.textContent="Scanning pages...";
  // Remove empty placeholder cards before adding real competitors
  for(let j=competitors.length-1;j>=0;j--){if(!competitors[j].name&&!competitors[j].website)competitors.splice(j,1);}
  for(const s of selected){
    const idx=competitors.length;
    competitors.push({name:s.name,website:s.url,pages:[],blogRss:null,_discovered:[]});
    renderCompetitors();
    // Auto-scan each
    try{
      const r=await fetch("/api/config/discover-pages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:s.url})});
      const d=await r.json();
      if(d.pages){
        competitors[idx]._discovered=d.pages.filter(function(p){return p.label!=="Homepage";});
        // Auto-add only Homepage; rest become suggestions
        const hp=d.pages.find(function(p){return p.label==="Homepage";});
        if(hp)competitors[idx].pages.push({id:"home",url:hp.url,type:"general",label:"Homepage"});
        if(d.pages.find(function(p){return p.rss;}))competitors[idx].blogRss=d.pages.find(function(p){return p.rss;}).rss;
      }
    }catch(e){} // Expected: page discovery fetch may fail
    renderCompetitors();
  }
  btn.textContent="Added!";
  document.getElementById("aiDiscover").style.display="none";
  document.querySelector(".ai-or").style.display="none";
}
function addCompetitor(){
  const lim=window._tierLimits;
  if(lim&&competitors.length>=lim.c){alert("You've reached your plan limit of "+lim.c+" competitors.");return;}
  competitors.push({name:"",website:"",pages:[],blogRss:null});
  renderCompetitors();
}
function removeCompetitor(idx){competitors.splice(idx,1);renderCompetitors();}
function renderCompetitors(){
  const el=document.getElementById("compList");
  el.innerHTML="";
  competitors.forEach((c,i)=>{
    const div=document.createElement("div");div.className="comp-card";
    div.innerHTML='<button class="remove" onclick="removeCompetitor('+i+')">&times;</button>'
      +'<label>Company Name</label><input type="text" value="'+esc(c.name||"")+'" onchange="competitors['+i+'].name=this.value" placeholder="Acme Inc">'
      +'<label>Website URL</label><div style="display:flex;gap:8px"><input type="url" value="'+esc(c.website||"")+'" id="url'+i+'" onchange="competitors['+i+'].website=this.value" placeholder="https://acme.com" style="flex:1;margin:0"><button class="btn btn-secondary btn-sm" onclick="scanSite('+i+')">Scan</button></div>'
      +'<div id="pages'+i+'" class="pages-list">'
      +'<label style="color:#7a8c52;font-weight:700;margin:12px 0 4px;display:block;text-transform:none;letter-spacing:0">Pages to Monitor</label>'
      +'<p style="font-size:12px;color:#6b7280;margin-bottom:8px">Add the specific pages you want to track for changes.</p>'
      +'<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center"><input type="url" id="custom'+i+'" placeholder="https://competitor.com/pricing" style="flex:1;margin:0"><select id="customType'+i+'" style="font-size:12px;background:#12161a;color:#d4d8de;border:1px solid #2a3038;border-radius:4px;padding:6px 8px"><option value="general">General</option><option value="pricing">Pricing</option><option value="features">Features</option><option value="blog">Blog</option><option value="careers">Careers</option></select><button class="btn btn-primary btn-sm" onclick="addCustomPage('+i+')">Add Page</button></div>'
      +'<div id="manualPages'+i+'">'+renderManualPages(i)+'</div>'
      +(c._discovered&&c._discovered.length?'<div style="margin-top:12px;padding-top:10px;border-top:1px solid #1a1f25"><label style="color:#6b7280;font-weight:600;margin-bottom:6px;display:block;text-transform:none;letter-spacing:0;font-size:11px">SUGGESTED PAGES <span style="font-weight:400">(from scan)</span></label>'+renderPageCheckboxes(i)+'</div>':'')
      +'</div>';
    el.appendChild(div);
  });
  const lim=window._tierLimits;
  document.getElementById("addCompBtn").style.display=(lim&&competitors.length>=lim.c)?"none":"inline-block";
}
function renderManualPages(idx){
  const manual=competitors[idx].pages;
  if(!manual||manual.length===0)return"";
  return manual.map(function(p,i){
    let prev="";
    if(p.preview&&p.preview.products&&p.preview.products.length>0){
      prev=' <span style="font-size:11px;color:#5c6b3c">'+p.preview.itemCount+' products ('+esc(p.preview.priceRange)+')</span>';
    }
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #1a1f25">'
      +'<span style="font-size:10px;text-transform:uppercase;color:#7a8c52;background:#1a2010;padding:2px 6px;border-radius:3px;flex-shrink:0">'+esc(p.type)+'</span>'
      +'<span style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(p.url)+'">'+esc(p.label||p.url)+prev+'</span>'
      +'<span class="page-url" style="flex-shrink:0;max-width:200px;overflow:hidden;text-overflow:ellipsis">'+esc(p.url)+'</span>'
      +'<button onclick="removeManualPage('+idx+','+i+')" style="background:none;border:1px solid #553333;color:#c55;cursor:pointer;border-radius:3px;padding:1px 6px;font-size:12px;flex-shrink:0">x</button>'
      +'</div>';
  }).join("");
}
function removeManualPage(ci,pi){
  competitors[ci].pages.splice(pi,1);
  const el=document.getElementById("manualPages"+ci);
  if(el)el.innerHTML=renderManualPages(ci);
}
function renderPageCheckboxes(idx){
  const c=competitors[idx];if(!c._discovered)return"";
  return c._discovered.map((p,pi)=>{
    const checked=c.pages.find(x=>x.url===p.url)?"checked":"";
    const sel='<select onchange="changePageType('+idx+','+pi+',this.value)" style="margin-left:6px;font-size:11px;background:#12161a;color:#d4d8de;border:1px solid #2a3038;border-radius:2px;padding:1px 4px">'
      +['general','pricing','features','blog','careers'].map(function(t){return'<option value="'+t+'"'+(p.type===t?' selected':'')+'>'+t+'</option>';}).join("")
      +'</select>';
    let prev='';
    if(p.preview&&p.preview.products&&p.preview.products.length>0){
      const prods=p.preview.products;
      const badge='<a href="#" onclick="toggleProducts(event,'+idx+','+pi+')" style="font-size:11px;color:#5c6b3c;margin-left:6px;text-decoration:none">'+p.preview.itemCount+' products ('+esc(p.preview.priceRange)+') <span id="arrow'+idx+'_'+pi+'">&#9654;</span></a>';
      const list='<div id="prodlist'+idx+'_'+pi+'" style="display:none;margin:6px 0 4px 24px;font-size:12px;border-left:2px solid #2a3038;padding-left:10px">'
        +prods.map(function(pr){return'<div style="display:flex;justify-content:space-between;padding:2px 0;color:#9ca3af"><span>'+(pr.name?esc(pr.name):'Item')+'</span><span style="color:#5c6b3c;font-weight:600;margin-left:12px">'+esc(pr.price)+'</span></div>';}).join("")
        +'</div>';
      prev=badge+list;
    }else if(p.preview){
      prev='<span style="font-size:11px;color:#5c6b3c;margin-left:6px">'+p.preview.itemCount+' items, '+esc(p.preview.priceRange)+'</span>';
    }
    return '<div style="margin-bottom:4px"><label style="display:flex;align-items:center;gap:4px;flex-wrap:wrap"><input type="checkbox" '+checked+' onchange="togglePage('+idx+','+pi+',this.checked)"> '+esc(p.label)+sel+' <span class="page-url">'+esc(p.url)+'</span></label>'+prev+'</div>';
  }).join("");
}
function toggleProducts(ev,ci,pi){
  ev.preventDefault();
  const el=document.getElementById("prodlist"+ci+"_"+pi);
  const arrow=document.getElementById("arrow"+ci+"_"+pi);
  if(el.style.display==="none"){el.style.display="block";arrow.innerHTML="&#9660;";}
  else{el.style.display="none";arrow.innerHTML="&#9654;";}
}
function changePageType(ci,pi,newType){
  competitors[ci]._discovered[pi].type=newType;
  const labels={pricing:"Pricing",blog:"Blog",careers:"Careers",general:"Page"};
  competitors[ci]._discovered[pi].label=labels[newType]||"Page";
  const disc=competitors[ci]._discovered[pi];
  const existing=competitors[ci].pages.find(function(x){return x.url===disc.url;});
  if(existing){existing.type=newType;existing.label=disc.label;}
}
function togglePage(ci,pi,on){
  const disc=competitors[ci]._discovered[pi];
  if(on){
    if(!competitors[ci].pages.find(x=>x.url===disc.url)){
      const entry={id:disc.type+"-"+competitors[ci].pages.length,url:disc.url,type:disc.type,label:disc.label};
      if(disc.rss)competitors[ci].blogRss=disc.rss;
      competitors[ci].pages.push(entry);
    }
  }else{
    competitors[ci].pages=competitors[ci].pages.filter(x=>x.url!==disc.url);
  }
}
function normalizeUrl(u){
  u=u.trim();if(!u)return u;
  if(!u.match(/^https?:/i))u="https://"+u;
  return u;
}
async function scanSite(idx){
  let u=normalizeUrl(document.getElementById("url"+idx).value);
  if(!u){alert("Enter a URL first.");return;}
  document.getElementById("url"+idx).value=u;
  competitors[idx].website=u;
  document.getElementById("pages"+idx).innerHTML='<p class="scanning" style="margin-top:8px">Scanning '+esc(u)+'...</p>';
  try{const r=await fetch("/api/config/discover-pages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u})});
  const d=await r.json();
  if(d.pages){
    competitors[idx]._discovered=d.pages.filter(function(p){return p.label!=="Homepage";});
    // Auto-add only Homepage; rest become suggestions
    const hp=d.pages.find(function(p){return p.label==="Homepage";});
    if(hp&&!competitors[idx].pages.find(function(p){return p.url===hp.url;})){
      competitors[idx].pages.push({id:"home",url:hp.url,type:"general",label:"Homepage"});
    }
    if(d.pages.find(function(p){return p.rss;}))competitors[idx].blogRss=d.pages.find(function(p){return p.rss;}).rss;
    renderCompetitors();
  }else{document.getElementById("pages"+idx).innerHTML='<p class="msg msg-err">Could not scan site.</p>';}
  }catch(e){document.getElementById("pages"+idx).innerHTML='<p class="msg msg-err">'+esc(e.message)+'</p>';}
}
function detectPageType(u){
  let p;try{p=new URL(u).pathname.toLowerCase();}catch(e){return{type:"general",label:"Custom"};}
  if(/(pricing|plans|price|plans-pricing)/.test(p))return{type:"pricing",label:"Pricing"};
  if(/(blog|news|updates|changelog|articles)/.test(p))return{type:"blog",label:"Blog"};
  if(/(careers|jobs|hiring|join)/.test(p))return{type:"careers",label:"Careers"};
  if(/(products|shop|store|catalog|collections)/.test(p))return{type:"general",label:"Products"};
  if(/(features|product|solutions)/.test(p))return{type:"general",label:"Features"};
  if(/(about|company|team)/.test(p))return{type:"general",label:"About"};
  if(/(docs|documentation|support|help)/.test(p))return{type:"general",label:"Docs"};
  return{type:"general",label:"Custom"};
}
async function addCustomPage(idx){
  const input=document.getElementById("custom"+idx);
  const typeSelect=document.getElementById("customType"+idx);
  const u=normalizeUrl(input.value);if(!u)return;
  const selType=typeSelect?typeSelect.value:"general";
  const detected=detectPageType(u);
  const type=selType!=="general"?selType:detected.type;
  const labels={pricing:"Pricing",blog:"Blog",careers:"Careers"};
  const label=labels[type]||detected.label;
  const entry={id:"custom-"+competitors[idx].pages.length,url:u,type:type,label:label};
  competitors[idx].pages.push(entry);
  input.value="";
  if(typeSelect)typeSelect.value="general";
  const el=document.getElementById("manualPages"+idx);
  if(el)el.innerHTML=renderManualPages(idx);
  // Fetch preview in background
  try{
    const r=await fetch("/api/config/preview-page",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:u})});
    const d=await r.json();
    if(d.preview){
      entry.preview=d.preview;
      el=document.getElementById("manualPages"+idx);
      if(el)el.innerHTML=renderManualPages(idx);
    }
  }catch(e){} // Expected: preview fetch may fail
}
function renderReview(){
  const ready=competitors.filter(c=>c.name&&c.website);
  const totalPages=ready.reduce((s,c)=>s+c.pages.length,0);
  document.getElementById("reviewSummary").innerHTML=
    '<div class="review-item"><span class="review-label">Slack</span><span>'+(slackVerified?"Connected":"<span style='color:#c4a747'>Skipped — configure later in Settings</span>")+'</span></div>'
    +'<div class="review-item"><span class="review-label">Competitors</span><span>'+ready.length+'</span></div>'
    +'<div class="review-item"><span class="review-label">Pages monitored</span><span>'+totalPages+'</span></div>'
    +'<div class="review-item"><span class="review-label">Product Hunt</span><span>'+(window._phTopics.length>0?window._phTopics.map(t=>t.name).join(", "):"Not configured")+'</span></div>'
    +'<div class="review-item"><span class="review-label">Reddit Radar</span><span>'+(window._radarSubreddits.length>0?window._radarSubreddits.map(s=>"r/"+s).join(", "):"Not configured")+'</span></div>'
    +'<div class="review-item"><span class="review-label">Plan</span><span>'+(window._tier||"scout").charAt(0).toUpperCase()+(window._tier||"scout").slice(1)+'</span></div>'
    +'<div class="review-item"><span class="review-label">Schedule</span><span>Daily at 9am UTC</span></div>';
}
// ── Product Hunt + Reddit Radar ──
window._radarSubreddits=[];
window._phTopics=[];
function showRadarSection(){
  document.getElementById("radarSection").style.display="block";
  document.getElementById("suggestPHBtn").style.display="inline-block";
  if(window._tier==="command"){
    document.getElementById("suggestSubsBtn").style.display="inline-block";
  }else{
    document.getElementById("radarMsg").innerHTML='<div style="font-size:12px;color:#6b7280;padding:8px 0">Auto-suggest available on the <a href="/billing" style="color:#7a8c52">Command plan</a>. You can still add subreddits manually below.</div>';
  }
  // Always show manual add input if no subs rendered yet
  if(window._radarSubreddits.length===0){
    document.getElementById("radarSubs").innerHTML='<div style="margin-top:4px;display:flex;align-items:center;gap:8px"><span style="color:#6b7280;font-size:14px;white-space:nowrap">r /</span><input type="text" id="customSubreddit" placeholder="affiliatemarketing" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="addCustomSub()">Add</button></div>'+'<div style="font-size:11px;color:#6b7280;margin-top:4px">Just the subreddit name (we strip r/ and full URLs automatically)</div>';
  }
  // Auto-suggest if we have product meta
  if(window._productMeta){
    if(window._phTopics.length===0)suggestPH();
    if(window._tier==="command"&&window._radarSubreddits.length===0)suggestSubs();
  }
}
async function suggestPH(){
  if(!window._productMeta){document.getElementById("phMsg").innerHTML='<div class="msg msg-info">Run AI discovery first.</div>';return;}
  const btn=document.getElementById("suggestPHBtn");
  btn.disabled=true;btn.textContent="Finding topics...";
  try{
    const r=await fetch("/api/config/suggest-ph-topics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productMeta:window._productMeta})});
    const d=await r.json();
    if(d.error){document.getElementById("phMsg").innerHTML='<div class="msg msg-err">'+esc(d.error)+'</div>';btn.disabled=false;btn.textContent="Suggest Topics";return;}
    const topics=d.topics||[];
    if(topics.length===0){document.getElementById("phMsg").innerHTML='<div class="msg">No relevant PH topics found.</div>';btn.disabled=false;btn.textContent="Suggest Topics";return;}
    window._phTopics=topics.map(t=>({slug:t.slug,name:t.name}));
    renderPHTopics(topics);
    btn.style.display="none";
  }catch(e){document.getElementById("phMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';btn.disabled=false;btn.textContent="Suggest Topics";}
}
function renderPHTopics(topics){
  const el=document.getElementById("phTopics");
  el.innerHTML=topics.map((t,i)=>{
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038">'
      +'<input type="checkbox" checked id="phCheck'+i+'" onchange="updatePHSelection()">'
      +'<div><strong style="color:#c4a747">'+esc(t.name)+'</strong>'
      +'<div style="font-size:12px;color:#6b7280">'+esc(t.reason||t.slug)+'</div></div></div>';
  }).join("") +
  '<div style="margin-top:12px;display:flex;align-items:center;gap:8px"><input type="text" id="customPHTopic" placeholder="e.g. developer-tools" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="addCustomPH()">Add</button></div>' +
  '<div style="font-size:11px;color:#6b7280;margin-top:4px">PH topic slug (lowercase, hyphenated)</div>';
}
function updatePHSelection(){
  const checks=document.querySelectorAll("[id^=phCheck]");
  const labels=document.querySelectorAll("#phTopics strong");
  window._phTopics=[];
  checks.forEach((cb,i)=>{if(cb.checked&&labels[i]){const name=labels[i].textContent;window._phTopics.push({slug:name.toLowerCase().replace(/\\s+/g,"-"),name});}});
}
function addCustomPH(){
  const inp=document.getElementById("customPHTopic");
  let slug=inp.value.trim().toLowerCase().replace(/\\s+/g,"-").replace(/[^a-z0-9-]/g,"");
  if(!slug)return;
  const name=slug.split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" ");
  window._phTopics.push({slug,name});
  const el=document.getElementById("phTopics");
  const idx=document.querySelectorAll("[id^=phCheck]").length;
  const div=document.createElement("div");
  div.style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038";
  div.innerHTML='<input type="checkbox" checked id="phCheck'+idx+'" onchange="updatePHSelection()"><div><strong style="color:#c4a747">'+esc(name)+'</strong><div style="font-size:12px;color:#6b7280">Custom topic</div></div>';
  const addRow=el.querySelector("div:last-child");
  if(addRow)el.insertBefore(div,addRow);else el.appendChild(div);
  inp.value="";
}
async function suggestSubs(){
  if(!window._productMeta){document.getElementById("radarMsg").innerHTML='<div class="msg msg-info">Run AI discovery first to enable radar.</div>';return;}
  const btn=document.getElementById("suggestSubsBtn");
  btn.disabled=true;btn.textContent="Finding subreddits...";
  try{
    const r=await fetch("/api/config/suggest-subreddits",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productMeta:window._productMeta})});
    const d=await r.json();
    if(d.error){document.getElementById("radarMsg").innerHTML='<div class="msg msg-err">'+esc(d.error)+'</div>';btn.disabled=false;btn.textContent="Suggest Subreddits";return;}
    const subs=(d.subreddits||[]).map(s=>({...s,name:s.name.toLowerCase().startsWith("r/")?s.name.slice(2):s.name}));
    if(subs.length===0){document.getElementById("radarMsg").innerHTML='<div class="msg">No relevant subreddits found.</div>';btn.disabled=false;btn.textContent="Suggest Subreddits";return;}
    window._radarSubreddits=subs.map(s=>s.name);
    renderRadarSubs(subs);
    btn.style.display="none";
  }catch(e){document.getElementById("radarMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';btn.disabled=false;btn.textContent="Suggest Subreddits";}
}
function renderRadarSubs(subs){
  subs=subs.map(s=>({...s,name:s.name.toLowerCase().startsWith("r/")?s.name.slice(2):s.name}));
  const el=document.getElementById("radarSubs");
  el.innerHTML=subs.map((s,i)=>{
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038">'
      +'<input type="checkbox" checked id="radarCheck'+i+'" onchange="updateRadarSelection()">'
      +'<div><strong style="color:#7a8c52">r/'+esc(s.name)+'</strong>'
      +'<div style="font-size:12px;color:#6b7280">'+esc(s.reason)+'</div></div></div>';
  }).join("") +
  '<div style="margin-top:12px;display:flex;align-items:center;gap:8px"><span style="color:#6b7280;font-size:14px;white-space:nowrap">r /</span><input type="text" id="customSubreddit" placeholder="affiliatemarketing" style="flex:1"><button class="btn btn-secondary btn-sm" onclick="addCustomSub()">Add</button></div>' +
  '<div style="font-size:11px;color:#6b7280;margin-top:4px">Just the subreddit name (we strip r/ and full URLs automatically)</div>';
}
function updateRadarSelection(){
  const allSubs=document.querySelectorAll("[id^=radarCheck]");
  const labels=document.querySelectorAll("#radarSubs strong");
  window._radarSubreddits=[];
  allSubs.forEach((cb,i)=>{if(cb.checked&&labels[i])window._radarSubreddits.push(labels[i].textContent.replace("r/",""));});
}
function addCustomSub(){
  const inp=document.getElementById("customSubreddit");
  let name=inp.value.trim();
  // Accept: "affiliatemarketing", "r/affiliatemarketing", "https://reddit.com/r/affiliatemarketing", etc.
  name=name.replace(/^https?:\\/\\/(www\\.)?reddit\\.com\\/r\\//i,"").replace(/^r\\//i,"").replace(/\\/.*$/,"").trim();
  if(!name)return;
  window._radarSubreddits.push(name);
  const el=document.getElementById("radarSubs");
  const idx=document.querySelectorAll("[id^=radarCheck]").length;
  const div=document.createElement("div");
  div.style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3038";
  div.innerHTML='<input type="checkbox" checked id="radarCheck'+idx+'" onchange="updateRadarSelection()"><div><strong style="color:#7a8c52">r/'+esc(name)+'</strong><div style="font-size:12px;color:#6b7280">Custom subreddit</div></div>';
  // Insert before the "Add custom" input row
  const addRow=el.querySelector("div:last-child");
  el.insertBefore(div,addRow);
  inp.value="";
}
function scanProgress(steps){
  return '<div class="scan-progress">'+steps.map((s,i)=>
    '<div class="scan-step'+s.state+'" id="scanStep'+i+'"><span class="dot"></span>'+s.text+'</div>'
  ).join("")+'</div>';
}
function setScanStep(idx,state){
  const el=document.getElementById("scanStep"+idx);if(!el)return;
  el.className="scan-step"+(state==="active"?" active":state==="done"?" done":"");
}
async function launch(){
  const btn=document.getElementById("launchBtn");btn.disabled=true;btn.textContent="Launching...";
  const msgEl=document.getElementById("launchMsg");
  const steps=[
    {text:"Saving competitor config...",state:""},
    {text:"Saving Slack settings...",state:""},
    {text:"Scanning competitor pages...",state:""},
    {text:"Analyzing with AI...",state:""},
    {text:"Preparing dashboard...",state:""}
  ];
  msgEl.innerHTML=scanProgress(steps);
  setScanStep(0,"active");
  try{
    const comps=competitors.filter(c=>c.name&&c.website).map(c=>({name:c.name,website:c.website,blogRss:c.blogRss||null,pages:c.pages.map(p=>({id:p.id,url:p.url,type:p.type,label:p.label}))}));
    if(comps.length===0){throw new Error("Add at least one competitor with a name and URL");}
    let r=await fetch("/api/config/competitors",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({competitors:comps})});
    let d=await r.json();if(!r.ok){throw new Error(d.error||"Failed to save competitors");}
    setScanStep(0,"done");setScanStep(1,"active");
    const slackUrlVal=document.getElementById("slackUrl").value.trim();
    const settingsPayload=slackUrlVal?{slackWebhookUrl:slackUrlVal}:{};
    if(window._productMeta)settingsPayload._productMeta=window._productMeta;
    if(window._phTopics&&window._phTopics.length>0)settingsPayload.productHuntTopics=window._phTopics;
    if(window._radarSubreddits&&window._radarSubreddits.length>0)settingsPayload.radarSubreddits=window._radarSubreddits;
    r=await fetch("/api/config/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(settingsPayload)});
    d=await r.json();if(!r.ok){throw new Error(d.error||"Failed to save settings");}
    setScanStep(1,"done");setScanStep(2,"active");
    btn.textContent="Scanning...";
    r=await fetch("/api/config/trigger-scan",{method:"POST",headers:{"Content-Type":"application/json"}});
    d=await r.json();
    setScanStep(2,"done");setScanStep(3,"done");setScanStep(4,"done");
    msgEl.innerHTML='<div class="msg msg-ok">Setup complete! Redirecting to dashboard...</div>';
    setTimeout(()=>{window.location.href="/dashboard";},1500);
  }catch(e){
    msgEl.innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';
    btn.disabled=false;btn.textContent="Save & Launch First Scan";
  }
}
loadUserInfo();
addCompetitor();
</script>
</body>
</html>`;

// ─── PARTNER APPLICATION HTML (hosted mode) ──────────────────────────────────

export const PARTNER_APPLY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Partner Program</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52}
.wrap{max-width:520px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:8px}
.highlight{color:#c4a747;font-size:18px;font-weight:700;margin-bottom:24px}
.panel{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:24px;margin-bottom:16px}
label{display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:6px}
input,textarea{width:100%;background:#0a0c0e;border:1px solid #2a3038;color:#d4d8de;padding:10px 12px;font-size:14px;border-radius:2px;outline:none;font-family:inherit}
input:focus,textarea:focus{border-color:#5c6b3c}
textarea{resize:vertical;min-height:60px}
.field{margin-bottom:16px}
.btn{display:inline-block;padding:12px 24px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;border:none;border-radius:2px;background:#c4a747;color:#0a0c0e}
.btn:hover{background:#d4b857}
.msg{padding:8px 12px;border-radius:2px;font-size:13px;margin-top:12px}
.msg-ok{background:#3d6b3522;border:1px solid #3d6b35;color:#3d6b35}
.msg-err{background:#c2303022;border:1px solid #c23030;color:#c23030}
</style>
</head>
<body>
<div class="wrap">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Partner Program</p>
<p class="highlight">Earn 50% recurring for 24 months</p>
<div class="panel">
<div class="field"><label>Your Name</label><input type="text" id="pName" required></div>
<div class="field"><label>Email</label><input type="email" id="pEmail" required></div>
<div class="field"><label>Website or Social Profile</label><input type="url" id="pWebsite" placeholder="https://"></div>
<div class="field"><label>PayPal Email (for payouts)</label><input type="email" id="pPaypal" required></div>
<div class="field"><label>How will you promote ScopeHound?</label><textarea id="pHow" placeholder="Blog, newsletter, YouTube, Twitter, etc."></textarea></div>
<button class="btn" onclick="apply()">Apply Now</button>
<div id="applyMsg"></div>
</div>
</div>
<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
async function apply(){
  const body={name:document.getElementById("pName").value,email:document.getElementById("pEmail").value,website:document.getElementById("pWebsite").value,paypalEmail:document.getElementById("pPaypal").value,promotionPlan:document.getElementById("pHow").value};
  if(!body.name||!body.email||!body.paypalEmail){document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">Name, email, and PayPal email are required.</div>';return;}
  try{const r=await fetch("/api/partner/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();
  if(d.success)document.getElementById("applyMsg").innerHTML='<div class="msg msg-ok">Application submitted! Your referral code: <strong>'+esc(d.code)+'</strong>. We will review and activate your account shortly.</div>';
  else document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">'+esc(d.error||"Failed")+'</div>';
  }catch(e){document.getElementById("applyMsg").innerHTML='<div class="msg msg-err">'+esc(e.message)+'</div>';}
}
</script>
</body>
</html>`;

// ─── PARTNER DASHBOARD HTML (hosted mode) ────────────────────────────────────

export const PARTNER_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Partner Dashboard</title>
<script type="text/javascript">(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","vep2hq6ftx");</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.6}
a{color:#7a8c52}
.wrap{max-width:800px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:24px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.stat{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px}
.stat-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px}
.stat-value{font-size:22px;font-weight:700;color:#c4a747}
.link-box{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px;margin-bottom:24px;display:flex;gap:8px;align-items:center}
.link-box input{flex:1;background:#0a0c0e;border:1px solid #2a3038;color:#d4d8de;padding:8px 12px;font-size:13px;border-radius:2px}
.link-box button{padding:8px 16px;background:#5c6b3c;color:#d4d8de;border:none;border-radius:2px;font-size:12px;font-weight:600;text-transform:uppercase;cursor:pointer}
table{width:100%;border-collapse:collapse;background:#12161a;border:1px solid #2a3038;border-radius:2px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1a1f25;font-size:13px}
th{color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.05em}
.empty{text-align:center;padding:32px;color:#6b7280}
@media(max-width:600px){.stats{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
<div class="wrap">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Partner Dashboard</p>
<div class="stats">
<div class="stat"><div class="stat-label">Referrals</div><div class="stat-value" id="sReferrals">-</div></div>
<div class="stat"><div class="stat-label">Active Subs</div><div class="stat-value" id="sActive">-</div></div>
<div class="stat"><div class="stat-label">Monthly Earnings</div><div class="stat-value" id="sMonthly">-</div></div>
<div class="stat"><div class="stat-label">Total Earned</div><div class="stat-value" id="sTotal">-</div></div>
</div>
<div class="link-box"><label style="font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;white-space:nowrap">Referral Link</label><input type="text" id="refLink" readonly><button onclick="navigator.clipboard.writeText(document.getElementById('refLink').value)">Copy</button></div>
<h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:12px">Referrals</h2>
<table><thead><tr><th>Email</th><th>Date</th><th>Tier</th><th>Commission</th><th>Status</th></tr></thead><tbody id="refTable"><tr><td colspan="5" class="empty">Loading...</td></tr></tbody></table>
</div>
<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
const params=new URLSearchParams(location.search);
const code=params.get("code"),email=params.get("email");
if(!code||!email){document.querySelector(".wrap").innerHTML='<p style="color:#c23030;padding:40px;text-align:center">Missing code or email parameter.</p>';}
else{fetch("/api/partner/stats?code="+code+"&email="+email).then(r=>r.json()).then(d=>{
  if(d.error){document.querySelector(".wrap").innerHTML='<p style="color:#c23030;padding:40px;text-align:center">'+esc(d.error)+'</p>';return;}
  document.getElementById("sReferrals").textContent=d.referralCount||0;
  document.getElementById("sActive").textContent=(d.referrals||[]).filter(r=>r.status==="active").length;
  document.getElementById("sMonthly").textContent="$"+((d.referrals||[]).reduce((s,r)=>s+(r.status==="active"?r.monthlyCommission:0),0)/100).toFixed(2);
  document.getElementById("sTotal").textContent="$"+((d.totalEarnings||0)/100).toFixed(2);
  document.getElementById("refLink").value=location.origin+"/?ref="+code;
  const tbody=document.getElementById("refTable");
  if(!d.referrals||d.referrals.length===0){tbody.innerHTML='<tr><td colspan="5" class="empty">No referrals yet</td></tr>';return;}
  tbody.innerHTML=d.referrals.map(r=>'<tr><td>'+esc(r.email)+'</td><td>'+new Date(r.signedUpAt).toLocaleDateString()+'</td><td>'+esc(r.tier)+'</td><td>$'+(r.monthlyCommission/100).toFixed(2)+'/mo</td><td>'+esc(r.status)+'</td></tr>').join("");
}).catch(()=>{});}
</script>
</body>
</html>`;

// ─── ADMIN LOGIN HTML ────────────────────────────────────────────────────────

export const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Admin Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:40px 32px;width:100%;max-width:380px}
h1{font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;text-align:center}
h1 span{color:#5c6b3c}
.sub{color:#6b7280;font-size:14px;margin-bottom:24px;text-align:center}
.error{background:#c2303022;border:1px solid #c23030;color:#c23030;padding:8px 12px;border-radius:2px;font-size:13px;margin-bottom:16px}
label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin-bottom:4px}
input{width:100%;padding:10px 12px;background:#0a0c0e;border:1px solid #2a3038;border-radius:2px;color:#d4d8de;font-size:14px;margin-bottom:16px}
input:focus{outline:none;border-color:#5c6b3c}
.btn{display:block;width:100%;padding:12px;background:#5c6b3c;color:#d4d8de;border:none;border-radius:2px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;cursor:pointer}
.btn:hover{background:#7a8c52}
</style>
</head>
<body>
<div class="card">
<h1>Scope<span>Hound</span></h1>
<p class="sub">Admin Console</p>
{{ERROR_BLOCK}}
<form method="POST" action="/admin/login">
<label for="username">Username</label>
<input type="text" id="username" name="username" required autocomplete="username">
<label for="password">Password</label>
<input type="password" id="password" name="password" required autocomplete="current-password">
<button type="submit" class="btn">Sign In</button>
</form>
</div>
</body>
</html>`;

// ─── ADMIN DASHBOARD HTML ────────────────────────────────────────────────────

export const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${FAVICON_LINK}
<title>ScopeHound — Admin Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0c0e;color:#d4d8de;line-height:1.5}
a{color:#7a8c52;text-decoration:none}
header{background:#12161a;border-bottom:1px solid #2a3038;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em}
header h1 span{color:#5c6b3c}
.admin-badge{font-size:10px;background:#c4a74722;color:#c4a747;border:1px solid #c4a74766;padding:2px 8px;border-radius:2px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700}
main{max-width:1100px;margin:0 auto;padding:24px}
h2{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;margin:24px 0 12px}
h2:first-child{margin-top:0}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.kpi{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:16px}
.kpi .label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;margin-bottom:4px}
.kpi .value{font-size:28px;font-weight:700;color:#d4d8de}
.kpi .value.green{color:#7a8c52}
.kpi .value.yellow{color:#c4a747}
.kpi .value.red{color:#c23030}
.table-wrap{background:#12161a;border:1px solid #2a3038;border-radius:2px;overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1a1f25;font-size:13px}
th{color:#6b7280;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.06em}
.tier-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:2px;text-transform:uppercase}
.tier-scout,.tier-recon{background:#2a303844;color:#6b7280;border:1px solid #2a3038}
.tier-operator{background:#5c6b3c22;color:#7a8c52;border:1px solid #5c6b3c66}
.tier-command,.tier-strategic{background:#c4a74722;color:#c4a747;border:1px solid #c4a74766}
.tier-none{background:#c2303022;color:#c23030;border:1px solid #c2303066}
.status-active{color:#7a8c52}
.status-canceled{color:#c23030}
.loading{text-align:center;padding:48px;color:#6b7280}
.refresh-btn{background:none;border:1px solid #2a3038;color:#6b7280;padding:6px 12px;border-radius:2px;font-size:11px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em}
.refresh-btn:hover{border-color:#5c6b3c;color:#d4d8de}
.utm-table{margin-top:4px}
.utm-table td:last-child{text-align:right;font-weight:700;color:#d4d8de}
.utm-table td:first-child{color:#9ca3af}
.tabs{display:flex;gap:0;border-bottom:1px solid #2a3038;margin-bottom:24px}
.tab{background:none;border:none;color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;padding:12px 20px;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s}
.tab:hover{color:#d4d8de}
.tab.active{color:#7a8c52;border-bottom-color:#7a8c52}
.tab .badge{font-size:9px;background:#c4a74733;color:#c4a747;padding:1px 6px;border-radius:8px;margin-left:6px;font-weight:700}
.contact-msg{background:#12161a;border:1px solid #2a3038;border-radius:2px;padding:20px;margin-bottom:12px}
.contact-msg.unread{border-left:3px solid #c4a747}
.contact-meta{display:flex;gap:16px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.contact-meta .name{font-weight:700;color:#d4d8de}
.contact-meta .email{color:#7a8c52;font-size:13px}
.contact-meta .time{color:#6b7280;font-size:11px;margin-left:auto}
.contact-body{color:#9ca3af;font-size:14px;line-height:1.7;white-space:pre-wrap}
.contact-actions{margin-top:12px;display:flex;gap:8px}
.contact-actions button{background:none;border:1px solid #2a3038;color:#6b7280;padding:4px 10px;border-radius:2px;font-size:10px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em}
.contact-actions button:hover{border-color:#5c6b3c;color:#d4d8de}
.contact-actions button.del:hover{border-color:#c23030;color:#c23030}
.type-badge{font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:2px 8px;border-radius:2px;margin-right:8px}
.type-badge.trial{background:rgba(196,167,71,0.15);color:#c4a747;border:1px solid #c4a747}
.contact-meta .website{color:#5c6b3c;font-size:12px;text-decoration:underline}
.empty-state{text-align:center;padding:48px;color:#6b7280;font-size:13px}
</style>
</head>
<body>
<header>
<div style="display:flex;align-items:center;gap:12px">
  <h1>Scope<span>Hound</span></h1>
  <span class="admin-badge">Admin</span>
</div>
<div style="display:flex;align-items:center;gap:12px">
  <button class="refresh-btn" onclick="currentTab==='contacts'?loadContacts():loadKPIs()">Refresh</button>
  <a href="/admin/logout" style="font-size:12px;color:#c23030">Sign Out</a>
</div>
</header>
<main>
<div class="tabs">
  <button class="tab active" onclick="showTab('kpis')">KPIs</button>
  <button class="tab" onclick="showTab('contacts')">Messages <span class="badge" id="msgCount" style="display:none">0</span></button>
</div>
<div id="kpis-tab"><div class="loading">Loading KPIs...</div></div>
<div id="contacts-tab" style="display:none"><div class="loading">Loading messages...</div></div>
</main>
<script>
function esc(s){if(!s)return"";const d=document.createElement("div");d.textContent=s;return d.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function fmt$(n){return"$"+Number(n).toLocaleString()}
function timeAgo(d){if(!d)return"awaiting scan";const s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}

let currentTab='kpis';
function showTab(tab){
  currentTab=tab;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('[onclick="showTab(\\''+tab+'\\')"]').classList.add('active');
  document.getElementById('kpis-tab').style.display=tab==='kpis'?'':'none';
  document.getElementById('contacts-tab').style.display=tab==='contacts'?'':'none';
  if(tab==='contacts')loadContacts();
}

async function loadKPIs(){
  document.getElementById("kpis-tab").innerHTML='<div class="loading">Loading KPIs...</div>';
  try{
    const r=await fetch("/api/admin/kpis");
    if(r.status===401){window.location.href="/admin/login";return;}
    if(!r.ok)throw new Error("Failed to load");
    renderDashboard(await r.json());
  }catch(e){
    document.getElementById("kpis-tab").innerHTML='<div class="loading">Failed to load KPIs. '+esc(e.message)+'</div>';
  }
}

async function loadContacts(){
  document.getElementById("contacts-tab").innerHTML='<div class="loading">Loading messages...</div>';
  try{
    const r=await fetch("/api/admin/contacts");
    if(r.status===401){window.location.href="/admin/login";return;}
    if(!r.ok)throw new Error("Failed to load");
    const data=await r.json();
    renderContacts(data.contacts||[]);
  }catch(e){
    document.getElementById("contacts-tab").innerHTML='<div class="loading">Failed to load messages. '+esc(e.message)+'</div>';
  }
}

async function markRead(id){
  await fetch("/api/admin/contacts?id="+id,{method:"PATCH"});
  const el=document.getElementById("msg-"+id);
  if(el)el.classList.remove("unread");
}

async function deleteMsg(id){
  if(!confirm("Delete this message?"))return;
  await fetch("/api/admin/contacts?id="+id,{method:"DELETE"});
  const el=document.getElementById("msg-"+id);
  if(el)el.remove();
}

function renderContacts(contacts){
  const unread=contacts.filter(c=>!c.read).length;
  const badge=document.getElementById("msgCount");
  if(unread>0){badge.textContent=unread;badge.style.display="";}else{badge.style.display="none";}
  if(contacts.length===0){
    document.getElementById("contacts-tab").innerHTML='<div class="empty-state">No messages yet.</div>';
    return;
  }
  let h='';
  for(const c of contacts){
    h+='<div class="contact-msg'+(c.read?'':' unread')+'" id="msg-'+esc(c.id)+'">';
    h+='<div class="contact-meta">';
    if(c.type==='trial_request')h+='<span class="type-badge trial">Trial Request</span>';
    h+='<span class="name">'+esc(c.name)+'</span><span class="email">'+esc(c.email)+'</span>';
    if(c.website)h+='<a href="'+esc(c.website)+'" target="_blank" class="website">'+esc(c.website)+'</a>';
    h+='<span class="time">'+timeAgo(c.createdAt)+'</span></div>';
    h+='<div class="contact-body">'+esc(c.message)+'</div>';
    h+='<div class="contact-actions">';
    if(!c.read)h+='<button onclick="markRead(\\''+c.id+'\\')">Mark Read</button>';
    h+='<button class="del" onclick="deleteMsg(\\''+c.id+'\\')">Delete</button>';
    h+='</div></div>';
  }
  document.getElementById("contacts-tab").innerHTML=h;
}

function kpi(label,value,color){
  return '<div class="kpi"><div class="label">'+esc(label)+'</div><div class="value'+(color?" "+color:"")+'">'+esc(String(value))+'</div></div>';
}

function utmTable(entries){
  if(!entries||entries.length===0)return'<div style="font-size:12px;color:#6b7280;padding:8px 0">No data yet</div>';
  let h='<div class="table-wrap utm-table"><table><tbody>';
  for(const[k,v]of entries)h+='<tr><td>'+esc(k)+'</td><td>'+v+'</td></tr>';
  h+='</tbody></table></div>';
  return h;
}

function renderDashboard(d){
  let h='';

  // ── User Metrics ──
  h+='<h2>User Metrics</h2><div class="kpi-grid">';
  h+=kpi("Total Users",d.users.total);
  h+=kpi("Active Subscribers",d.users.active,"green");
  h+=kpi("Churned",d.users.churned,"red");
  h+=kpi("Churn Rate",d.users.churnRate,"yellow");
  h+='</div>';

  // ── Revenue ──
  h+='<h2>Revenue</h2><div class="kpi-grid">';
  h+=kpi("Estimated MRR",fmt$(d.revenue.estimatedMRR),"green");
  h+=kpi("Estimated ARR",fmt$(d.revenue.estimatedARR),"green");
  const dist=d.revenue.planDistribution||{};
  h+=kpi("Scout Plans",dist.scout||0);
  h+=kpi("Operator Plans",dist.operator||0);
  h+=kpi("Command Plans",dist.command||0);
  h+='</div>';

  // ── Engagement ──
  h+='<h2>Engagement</h2><div class="kpi-grid">';
  h+=kpi("DAU (Today)",d.engagement.dau);
  h+=kpi("WAU (7 Days)",d.engagement.wau);
  h+=kpi("NURR (New User Retention)",d.engagement.nurr,"green");
  h+=kpi("CURR (Current Retention)",d.engagement.curr,"green");
  h+='</div>';

  // ── Acquisition ──
  h+='<h2>Acquisition — Source</h2>';
  h+=utmTable(d.acquisition.bySource);
  h+='<h2>Acquisition — Medium</h2>';
  h+=utmTable(d.acquisition.byMedium);
  if(d.acquisition.byCampaign&&d.acquisition.byCampaign.length>0){
    h+='<h2>Acquisition — Campaign</h2>';
    h+=utmTable(d.acquisition.byCampaign);
  }

  // ── Users by Tier ──
  if(d.users.byTier&&Object.keys(d.users.byTier).length>0){
    h+='<h2>Users by Tier</h2><div class="kpi-grid">';
    for(const[tier,count]of Object.entries(d.users.byTier)){
      h+=kpi(tier==="none"?"No Plan":tier.charAt(0).toUpperCase()+tier.slice(1),count);
    }
    h+='</div>';
  }

  // ── Recent Signups ──
  if(d.users.recentSignups&&d.users.recentSignups.length>0){
    h+='<h2>Recent Signups (30d)</h2><div class="table-wrap"><table><thead><tr><th>Email</th><th>Tier</th><th>Status</th><th>Source</th><th>Signed Up</th></tr></thead><tbody>';
    for(const u of d.users.recentSignups){
      const tc=u.tier?"tier-"+u.tier:"tier-none";
      const sc=u.status==="active"?"status-active":u.status==="canceled"?"status-canceled":"";
      h+='<tr><td>'+esc(u.email)+'</td><td><span class="tier-badge '+tc+'">'+(u.tier||"none")+'</span></td><td class="'+sc+'">'+(u.status||"—")+'</td><td>'+(esc(u.source)||"—")+'</td><td>'+timeAgo(u.createdAt)+'</td></tr>';
    }
    h+='</tbody></table></div>';
  }

  // ── Timestamp ──
  h+='<div style="text-align:center;padding:24px 0;font-size:11px;color:#6b7280">Generated: '+esc(d.generatedAt)+'</div>';

  document.getElementById("kpis-tab").innerHTML=h;
}

loadKPIs();
// Pre-fetch contact count for badge
fetch("/api/admin/contacts").then(r=>r.json()).then(d=>{
  const unread=(d.contacts||[]).filter(c=>!c.read).length;
  const badge=document.getElementById("msgCount");
  if(unread>0){badge.textContent=unread;badge.style.display="";}
}).catch(()=>{});
</script>
</body>
</html>`;

