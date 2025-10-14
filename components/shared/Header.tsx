"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import NotificationBell from "./NotificationBell";
import AddToHomeButton from "./AddToHomeButton";
import useStandalone from "@/hooks/useStandalone";

const NAV = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Invest", href: "/invest" },
  { name: "Activity", href: "/activity" },
  { name: "Cards", href: "/cards" },
];

export default function Header() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const pathname = usePathname();
  const router = useRouter();

  const { user, loading } = useUser();
  const { logout: privyLogout } = usePrivy();

  const isStandalone = useStandalone();
  // Toggle sizes: PWA (standalone) vs browser
  const headerH = isStandalone ? "h-26" : "h-14"; // or "h-[6.5rem]" instead of h-26
  const itemsMt = isStandalone ? "mt-9" : "mt-0";

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        menuOpen &&
        menuRef.current &&
        !menuRef.current.contains(t) &&
        buttonRef.current &&
        !buttonRef.current.contains(t)
      ) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setSidebarOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const isAuthed = !!user && !loading;
  const firstName = (user?.firstName || "").trim();
  const email = user?.email || "";
  const avatarInitial = (firstName || email || "U").charAt(0).toUpperCase();
  const homeHref = isAuthed ? "/dashboard" : "/";

  const handleLogout = async () => {
    try {
      setMenuOpen(false);
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
      await privyLogout?.().catch(() => {});
    } finally {
      document.cookie = "onboarded=; Max-Age=0; path=/";
      router.replace("/sign-in");
    }
  };

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/40 backdrop-blur">
        <div
          className={`mx-auto flex items-center justify-between px-4 md:px-6 ${headerH}`}
        >
          {/* LEFT: logo + greeting */}
          <div className={`flex items-center gap-4 flex-shrink-0 ${itemsMt}`}>
            <Link href={homeHref}>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full">
                  <Image
                    src={"/logo.jpg"}
                    alt="logo"
                    width={60}
                    height={60}
                    className="rounded-full mt-1"
                  />
                </div>
                <div>
                  {isAuthed ? (
                    <>
                      <p className="text-xs text-muted-foreground">Welcome to,</p>
                      <p className="font-semibold text-foreground">
                        Haven
                      </p>
                    </>
                  ) : (
                    <span className="font-semibold text-foreground">
                      Haven Vaults
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </div>

          {/* CENTER: nav (md+ absolute centered) */}
          <nav className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            {NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm transition-all ${
                    active
                      ? "bg-primary/20 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* RIGHT: bell + user dropdown + hamburger */}
          <div className={`flex items-center gap-3 ${itemsMt}`}>
            {isAuthed ? (
              <>
                <NotificationBell />

                <div className="relative">
                  <button
                    ref={buttonRef}
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/80 transition-colors"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    {avatarInitial}
                  </button>

                  {menuOpen && (
                    <div
                      ref={menuRef}
                      role="menu"
                      aria-label="Account menu"
                      className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-white/10 bg-black/92 backdrop-blur-xl shadow-[0_24px_48px_rgba(0,0,0,0.5)] p-2"
                    >
                      {/* tiny caret */}
                      <div className="absolute -top-2 right-6 h-4 w-4 rotate-45 rounded-sm bg-black/40 border-l border-t border-white/10" />

                      {/* header */}
                      <div className="flex items-center gap-3 rounded-xl px-3 py-3 bg-white/[0.03] border border-white/10">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                          {(email?.[0] || "•").toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            Signed in as
                          </p>
                          <p
                            className="truncate text-sm text-foreground"
                            title={email}
                          >
                            {email}
                          </p>
                        </div>
                      </div>

                      <div className="my-2 h-px bg-white/10" />

                      {/* items */}
                      <div className="mt-1">
                        <Link
                          href="/settings"
                          role="menuitem"
                          onClick={() => setMenuOpen(false)}
                          className="menu-item group flex items-center gap-3 rounded-xl px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(182,255,62)]/40 hover:bg-white/10"
                        >
                          {/* icon: settings */}
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            className="flex-none opacity-80 group-hover:opacity-100"
                          >
                            <path
                              fill="currentColor"
                              d="M12 8.5a3.5 3.5 0 1 1 0 7 a3.5 3.5 0 0 1 0-7m9.94 3.06l-1.94-.5a7.8 7.8 0 0 0-.7-1.68l1.13-1.6c.24-.35.2-.82-.1-1.12l-1.29-1.29c-.3-.3-.77-.34-1.12-.1l-1.6 1.13c-.54-.3-1.1-.53-1.69-.7l-.49-1.94A.9.9 0 0 0 12 2h-1.83a.9.9 0 0 0-.88.69l-.5 1.94c-.58.17-1.14.4-1.68.7L5.5 4.1a.85.85 0 0 0-1.12.1L3.1 5.5a.85.85 0 0 0-.1 1.12l1.13 1.6c-.3.54-.53 1.1-.7 1.68l-1.94.5a.9.9 0 0 0-.69.88V13c0 .41.28.77.69.88l1.94.5c.17.58.4 1.14.7 1.68l-1.13 1.6a.85.85 0 0 0 .1 1.12l1.29 1.29c.3.3.77.34 1.12.1l1.6-1.13c.54.3 1.1.53 1.68.7l.5 1.94c.11.41.47.69.88.69H12c.41 0 .77-.28.88-.69l.49-1.94c.59-.17 1.15-.4 1.69-.7l1.6 1.13c.35.24.82.2 1.12-.1l1.29-1.29c.3-.3.34-.77.1-1.12l-1.13-1.6c.3-.54.53-1.1.7-1.68l1.94-.5c.41-.11.69-.47.69-.88V12a.9.9 0 0 0-.69-.88Z"
                            />
                          </svg>
                          <span className="flex-1">Settings</span>
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            className="opacity-0 -translate-x-1 transition group-hover:opacity-80 group-hover:translate-x-0"
                          >
                            <path fill="currentColor" d="M9 6l6 6l-6 6" />
                          </svg>
                        </Link>

                        {/* Add to Home (kept your component) */}
                        <AddToHomeButton
                          variant="menu"
                          onDone={() => setMenuOpen(false)}
                        />

                        <div className="my-2 h-px bg-white/10" />

                        <button
                          role="menuitem"
                          onClick={handleLogout}
                          className="menu-item w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 text-red-300 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                        >
                          {/* icon: logout */}
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            className="flex-none"
                          >
                            <path
                              fill="currentColor"
                              d="M16 17l1.41-1.41L14.83 13H21v-2h-6.17l2.58-2.59L16 7l-5 5z"
                            />
                            <path
                              fill="currentColor"
                              d="M3 19h8v-2H5V7h6V5H3z"
                            />
                          </svg>
                          <span className="flex-1">Log out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Hamburger (mobile only) */}
                <button
                  aria-label="Open menu"
                  onClick={() => setSidebarOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-foreground hover:bg-white/20 transition-colors md:hidden"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 6h16M4 12h16M4 18h16"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </>
            ) : loading ? (
              <div className="h-8 w-24 rounded-full bg-white/10 animate-pulse" />
            ) : (
              <Link href="/sign-in" className="btn-neon text-sm">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Sidebar drawer (unchanged) */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-200 ease-out"
            style={{
              transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
            }}
          >
            <div className="glass h-full border-r border-border">
              <div className="flex h-16 items-center justify-between border-b border-border px-4">
                <span className="font-semibold text-foreground">Menu</span>
                <button
                  aria-label="Close menu"
                  onClick={() => setSidebarOpen(false)}
                  className="icon-btn"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <nav className="px-2 py-3">
                {NAV.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`mb-1 block rounded-2xl px-3 py-2 text-sm transition ${
                        active
                          ? "tab-active"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      }`}
                    >
                      {item.name}
                    </Link>
                  );
                })}

                <div className="mt-6 border-t border-border px-3 pt-4 text-xs text-muted-foreground">
                  © {new Date().getFullYear()} Haven Bank
                </div>
              </nav>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
