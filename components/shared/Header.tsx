// app/components/Header.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { useUser } from "@/providers/UserProvider";
import NotificationBell from "./NotificationBell";

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

  // from our provider
  const { user, loading } = useUser();

  // only used to end Privy session on logout
  const { logout: privyLogout } = usePrivy();

  // click-away + Esc handlers
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
  const displayName = firstName || email || "User"; // ← ONLY first name (fallbacks only)
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
        <div className="mx-auto flex h-16 items-center justify-between px-4 md:px-6">
          {/* left: logo + greeting */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
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
                        <p className="text-xs text-muted-foreground">Hello,</p>
                        <p className="font-semibold text-foreground">
                          {displayName}
                        </p>
                      </>
                    ) : (
                      <span className="font-semibold text-foreground">
                        Haven Bank
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          </div>

          {/* center: nav */}
          <nav className="hidden md:flex items-center gap-1">
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

          {/* right: actions */}
          <div className="flex items-center gap-3">
            {isAuthed ? (
              <>
                <NotificationBell/>

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
                      className="absolute right-0 mt-2 w-56 overflow-hidden rounded-3xl menu-surface"
                    >
                      <div className="menu-divider border-b px-4 py-3 text-xs text-muted-foreground">
                        <p className="uppercase tracking-wide">Signed in as</p>
                        <p className="truncate text-foreground">{email}</p>
                      </div>

                      <Link
                        href="/settings"
                        className="menu-item"
                        onClick={() => setMenuOpen(false)}
                        role="menuitem"
                      >
                        Settings
                      </Link>

                      <button
                        className="w-full text-left menu-item text-red-300 hover:bg-red-500/10"
                        onClick={handleLogout}
                        role="menuitem"
                      >
                        Log out
                      </button>
                    </div>
                  )}
                </div>

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

      {/* sidebar drawer */}
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
