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
      </body>
    </html>
  );
}
