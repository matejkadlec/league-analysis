"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Menu, X, User, LogOut, Settings, Users, Wrench } from "lucide-react";
import { CookieSettingsTrigger } from "@/components/cookie-settings-trigger";
import { LEGAL_LINK_CLASS, LegalNotice } from "@/components/legal-notice";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import {
  isPlayerCentricPath,
  playerNavigationRoute,
  SidebarPlayerSwitcher,
} from "@/features/players";

interface NavItem {
  name: string;
  path: string;
}

const navItems: NavItem[] = [
  { name: "Home", path: "/" },
  { name: "Player Overview", path: "/player-overview" },
  { name: "Match History", path: "/match-history" },
  { name: "Rank Manipulation", path: "/rank-manipulation" },
  { name: "Matchmaking Analysis", path: "/matchmaking-analysis" },
];

export function SidebarNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [managePlayersOpen, setManagePlayersOpen] = useState(false);
  // Sign out awaits the server before clearing anything, because only the
  // server can revoke. Against a backend that hangs, that is the full probe
  // deadline with nothing on screen moving -- the button reads as dead and
  // every further click stacks another request.
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Scoped to player-centric routes, exactly as `player-context.tsx` scopes
  // its own read. `/matchmaking-analysis` also carries `?puuid=`, but that is
  // a page-local analyzed player; carrying it onto these links would hand it
  // to a route the provider *does* persist from, quietly making a local
  // choice the account's current player.
  const urlPuuid = isPlayerCentricPath(pathname)
    ? searchParams.get("puuid")
    : null;
  const { user, logout, isAuthenticated, isLoading } = useAuth();

  // Hide sidebar on public auth pages or when not authenticated
  if (
    pathname === "/sign-in" ||
    pathname === "/join-us" ||
    isLoading ||
    !isAuthenticated
  ) {
    return null;
  }

  const isActive = (path: string) => {
    if (path === "/") {
      return pathname === "/";
    }
    return pathname.startsWith(path);
  };

  return (
    <>
      {/* Mobile Hamburger Button */}
      <button
        type="button"
        className="fixed left-4 top-4 z-50 rounded-md bg-[#0a1428] p-2 text-white shadow-lg transition-colors hover:bg-[#0d1a33] md:hidden"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Toggle menu"
      >
        {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Sidebar Menu */}
      <aside
        suppressHydrationWarning
        style={{ backgroundColor: "#0a1428" }}
        className={`fixed inset-y-0 left-0 z-40 w-[240px] transform shadow-xl transition-transform duration-300 ease-in-out md:sticky md:top-0 md:h-screen md:w-[220px] lg:w-[240px] ${
          menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Logo Section */}
          <div className="border-b border-white/10 p-5">
            <Link
              href="/"
              className="sidebar-logo-link block cursor-pointer transition-opacity duration-300 hover:opacity-80"
              onClick={() => setMenuOpen(false)}
            >
              <div className="relative mx-auto hidden h-[55px] w-[165px] md:block">
                <Image
                  src="/logo-v3.png"
                  alt="League Analysis Logo"
                  fill
                  sizes="165px"
                  className="object-contain"
                  priority
                />
              </div>
              <div className="text-center text-xl font-bold text-white md:hidden">
                League Analysis
              </div>
            </Link>
          </div>

          <SidebarPlayerSwitcher
            manageOpen={managePlayersOpen}
            onManageOpenChange={setManagePlayersOpen}
            onNavigate={() => setMenuOpen(false)}
          />

          {/* Navigation Links */}
          <nav
            className="flex min-h-0 flex-1 flex-col pt-3 pb-3"
            suppressHydrationWarning
          >
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {navItems.map((item) => {
                const active = isActive(item.path);
                const href = playerNavigationRoute(item.path, urlPuuid);

                return (
                  <li key={item.name}>
                    <Link
                      href={href}
                      onClick={() => setMenuOpen(false)}
                      data-active={active}
                      className={`block border-l-4 px-6 py-3 text-white transition-colors duration-300 hover:bg-white/10 ${
                        active
                          ? "border-[#cfa93a] bg-white/5"
                          : "border-transparent hover:border-[#cfa93a]/50"
                      }`}
                    >
                      <span
                        suppressHydrationWarning
                        className={`transition-colors duration-300 ${
                          active
                            ? "text-[#cfa93a] font-medium"
                            : "hover:text-[#cfa93a]"
                        }`}
                      >
                        {item.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setManagePlayersOpen(true)}
              data-testid="view-tracked-players-button"
              className="mx-3 mt-auto hidden h-8 shrink-0 justify-start gap-2 px-2 text-xs text-white/65 hover:bg-white/10 hover:text-white"
            >
              <Users className="h-3.5 w-3.5" /> View Tracked Players
            </Button>
          </nav>

          {/* User Info and Bottom Links */}
          {user && (
            <div className="border-t border-white/10">
              <div className="text-xs">
                <div className="flex items-center gap-2 text-white p-4 pb-2">
                  <User className="h-4 w-4 text-[#cfa93a]" />
                  <p className="font-medium">{user.display_name}</p>
                </div>

                {user.is_admin && (
                  <Link
                    href="/jobs"
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-2 px-4 py-2 text-white cursor-pointer transition-colors duration-300 hover:text-[#cfa93a] ${
                      isActive("/jobs") ? "text-[#cfa93a] font-medium" : ""
                    }`}
                  >
                    <Wrench className="h-4 w-4 text-[#cfa93a]" />
                    Jobs
                  </Link>
                )}

                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-2 px-4 py-2 text-white cursor-pointer transition-colors duration-300 hover:text-[#cfa93a] ${
                    isActive("/settings") ? "text-[#cfa93a] font-medium" : ""
                  }`}
                >
                  <Settings className="h-4 w-4 text-[#cfa93a]" />
                  Settings
                </Link>

                <button
                  type="button"
                  onClick={() => {
                    setSigningOut(true);
                    void logout({
                      evenIfTheServerCannotBeReached: true,
                    }).finally(() => setSigningOut(false));
                  }}
                  disabled={signingOut}
                  className="flex items-center gap-2 px-4 py-2 pb-4 text-white cursor-pointer transition-colors duration-300 hover:text-[#cfa93a] w-full text-left disabled:cursor-default disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4 text-[#cfa93a] scale-x-[-1]" />
                  {signingOut ? "Signing out…" : "Sign Out"}
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-white/10 p-6">
            {/* The cookie policy tells every reader they can reopen the
                dialog "using the Cookie settings link in the page footer".
                Only the public footer carried one, so for a signed-in reader
                that sentence named a control this shell did not render. */}
            <LegalNotice>
              <CookieSettingsTrigger className={LEGAL_LINK_CLASS} />
            </LegalNotice>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        />
      )}
    </>
  );
}
