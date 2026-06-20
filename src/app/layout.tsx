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
 * - Production domain only, so dev/preview never pollute the data.
 * - Sends path + referrer only; the server stores no PII (see analytics-core).
 * - Tracks SPA route changes by wrapping history.pushState/replaceState.
 */
const ANALYTICS = `(function(){
  try{ if(navigator.doNotTrack==='1'||window.doNotTrack==='1'||navigator.msDoNotTrack==='1') return; }catch(e){}
  if(location.hostname!=='pickems.phatt.vip') return;
  var last='';
  function send(){
    try{
      var p=location.pathname; if(p===last) return; last=p;
      var body=JSON.stringify({path:p,referrer:document.referrer||''});
      if(navigator.sendBeacon){ navigator.sendBeacon('/api/stats/collect', new Blob([body],{type:'application/json'})); }
      else { fetch('/api/stats/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true}); }
    }catch(e){}
  }
  function wrap(m){ var o=history[m]; if(typeof o!=='function') return; history[m]=function(){ var r=o.apply(this,arguments); send(); return r; }; }
  wrap('pushState'); wrap('replaceState');
  window.addEventListener('popstate', send);
  send();
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
