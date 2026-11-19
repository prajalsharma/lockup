"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setSound, soundEnabled, sfx } from "@/lib/sound";

const LINKS = [
  { href: "/yard", label: "The yard" },
  { href: "/#how", label: "How it works" },
  { href: "/#check", label: "Check it" },
  { href: "/haul", label: "My haul" },
];

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`display inline-flex items-center gap-2 text-[26px] leading-none ${className}`}>
      <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden>
        <path d="M4.5 9V6a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <rect x="1" y="9" width="16" height="12" rx="1.5" fill="var(--accent)" />
        <rect x="8" y="13" width="2" height="4.5" fill="var(--on-accent)" />
      </svg>
      Lockup
    </span>
  );
}

function IconButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-label={label} aria-pressed={pressed} title={label} onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 transition-colors duration-200 hover:border-line-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

export function SiteHeader() {
  const path = usePathname();
  const [solid, setSolid] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sound, setSnd] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setSnd(soundEnabled());
    setTheme((document.documentElement.dataset.theme as "dark" | "light") || "dark");
    const f = () => setSolid(window.scrollY > 24);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  useEffect(() => setMenu(false), [path]);

  const flipTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("lockup.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  const flipSound = () => {
    const next = !sound;
    setSound(next); setSnd(next);
    if (next) sfx.tick();
  };

  return (
    <header
      className={`site-header fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200 ${solid || menu ? "border-line bg-ground" : "border-transparent"}`}
    >
      <div className="wrap flex h-16 items-center gap-6">
        <Link href="/" aria-label="Lockup home"><Wordmark /></Link>
        <nav className="ml-6 hidden items-center gap-7 text-[15px] text-ink-2 md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined} className="ulink transition-colors duration-200 hover:text-ink aria-[current=page]:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <IconButton label={sound ? "Turn sound off" : "Turn sound on"} pressed={sound} onClick={flipSound}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" stroke="none" />
              {sound ? <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.6a6 6 0 0 1 0 8.8" /> : <path d="M10.5 6l4 4M14.5 6l-4 4" />}
            </svg>
          </IconButton>
          <IconButton label={theme === "dark" ? "Switch to day yard" : "Switch to night yard"} onClick={flipTheme}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              {theme === "dark"
                ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" fill="currentColor" />
                : <g stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3" fill="currentColor" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" /></g>}
            </svg>
          </IconButton>
          <Link href="/yard" className="btn btn-primary btn-sm hidden sm:inline-flex">Enter the yard</Link>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-lg border border-line md:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              {menu ? <path d="M3 3l10 10M13 3L3 13" /> : <path d="M2 5h12M2 11h12" />}
            </svg>
          </button>
        </div>
      </div>
      {menu && (
        <nav className="wrap flex flex-col border-t border-line pb-5 md:hidden" aria-label="Mobile">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMenu(false)} className="border-b border-line py-4 text-lg">{l.label}</Link>
          ))}
          <Link href="/yard" className="btn btn-primary mt-5">Enter the yard</Link>
        </nav>
      )}
    </header>
  );
}
