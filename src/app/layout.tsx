import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";
import { HeatBackground } from "@/components/heat/HeatBackground";

export const metadata: Metadata = {
  title: "HOTLINE",
  description: "CS2 Major Pick'Em companion for IEM Cologne 2026",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HOTLINE",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0805",
};

/**
 * Stale-build self-heal (PHA-1269). If a device is serving an old cached HTML
 * that references hashed JS/CSS chunks which no longer exist on the current
 * deploy, those chunk requests 404 — webpack throws a `ChunkLoadError` and the
 * app fails to hydrate, i.e. a white screen ("he loads the cached version").
 * This tiny inline script (runs during HTML parse, before any chunk, so it works
 * even when every chunk is dead) catches that exact failure — a failed
 * `/_next/static/` script/stylesheet or a ChunkLoadError — and recovers ONCE per
 * session: drop any service worker + Cache Storage, then hard-reload to pull the
 * current build. The sessionStorage guard means it can never loop.
 */
const CHUNK_RECOVERY = `(function(){
  function recover(){
    try{ if(sessionStorage.getItem('hl-recover')) return; sessionStorage.setItem('hl-recover','1'); }catch(e){}
    try{ if('serviceWorker' in navigator){ navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }); } }catch(e){}
    try{ if(window.caches){ caches.keys().then(function(ks){ ks.forEach(function(k){ caches.delete(k); }); }); } }catch(e){}
    setTimeout(function(){ location.reload(); }, 60);
  }
  window.addEventListener('error', function(e){
    var t = e && e.target;
    if(t && (t.tagName === 'SCRIPT' || t.tagName === 'LINK')){
      var url = t.src || t.href || '';
      if(url.indexOf('/_next/static/') !== -1){ recover(); return; }
    }
    var err = e && e.error;
    if(err && err.name === 'ChunkLoadError'){ recover(); }
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    if(r && (r.name === 'ChunkLoadError' || (typeof r.message === 'string' && r.message.indexOf('Loading chunk') !== -1))){ recover(); }
  });
})();`;

/**
 * Built-in privacy-friendly pageview tracker (PHA-1277). Tiny inline script — no
 * external file, no third-party CDN, no extra request — so it adds ~0 weight and
 * never blocks paint (it only fires sendBeacon after load / on navigation). This
 * app is GPU/perf sensitive (PHA-1267/1268/1269), so there is deliberately no
 * blur, animation, or polling here.
 *
 * - Honors Do-Not-Track (sends nothing).
 * - Skips local dev (localhost / *.local), so only real visits are counted —
 *   not coupled to a specific prod host (the app serves both hotline.phatt.vip
 *   and pickems.phatt.vip).
 * - Sends path + referrer only; the server stores no PII (see analytics-core).
 * - Tracks SPA route changes by wrapping history.pushState/replaceState.
 * - Also records anonymous in-app events: <details> opens ("disclosure_open",
 *   labelled by the summary text) and max scroll depth ("scroll") on leave —
 *   plus window.__hlTrack(name,label) for explicit events. All cookieless.
 */
const ANALYTICS = `(function(){
  try{ if(navigator.doNotTrack==='1'||window.doNotTrack==='1'||navigator.msDoNotTrack==='1') return; }catch(e){}
  var h=location.hostname;
  if(h==='localhost'||h==='127.0.0.1'||h==='0.0.0.0'||h==='::1'||h.indexOf('.')===-1||h.slice(-6)==='.local') return;
  function post(o){
    try{
      o.path=location.pathname;
      var body=JSON.stringify(o);
      if(navigator.sendBeacon){ navigator.sendBeacon('/api/stats/collect', new Blob([body],{type:'application/json'})); }
      else { fetch('/api/stats/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}); }
    }catch(e){}
  }
  window.__hlTrack=function(name,label){ if(name) post({event:String(name),label:label?String(label):''}); };
  var last='', maxScroll=0;
  function flushScroll(){ if(maxScroll>=25){ post({event:'scroll',scroll:maxScroll}); maxScroll=0; } }
  function view(){
    var p=location.pathname; if(p===last) return; last=p;
    flushScroll(); maxScroll=0;
    post({referrer:document.referrer||''});
  }
  function wrap(m){ var o=history[m]; if(typeof o!=='function') return; history[m]=function(){ var r=o.apply(this,arguments); view(); return r; }; }
  wrap('pushState'); wrap('replaceState');
  window.addEventListener('popstate', view);
  // <details> opens (FAQ / settings / help disclosures) — the original question.
  document.addEventListener('toggle', function(e){
    var t=e.target;
    if(t&&t.tagName==='DETAILS'&&t.open){
      var s=t.querySelector('summary');
      post({event:'disclosure_open',label:(s&&s.textContent||'').slice(0,80)});
    }
  }, true);
  // Max scroll depth, flushed on leave.
  window.addEventListener('scroll', function(){
    var d=document.documentElement, sh=d.scrollHeight-d.clientHeight;
    if(sh>0){ var pct=Math.round((d.scrollTop||document.body.scrollTop)/sh*100); if(pct>maxScroll) maxScroll=pct; }
  }, {passive:true});
  window.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') flushScroll(); });
  window.addEventListener('pagehide', flushScroll);
  view();
})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_RECOVERY }} />
        <HeatBackground />
        {children}
        <PwaRegister />
        <script dangerouslySetInnerHTML={{ __html: ANALYTICS }} />
      </body>
    </html>
  );
}
