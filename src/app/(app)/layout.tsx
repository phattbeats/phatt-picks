import { MobileNav } from "@/components/ui/MobileNav";

/** Shell layout for authenticated / main-app pages (show mobile nav). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="with-nav" style={{ position: "relative", zIndex: 1 }}>
        {children}
      </main>
      <MobileNav />
    </>
  );
}
