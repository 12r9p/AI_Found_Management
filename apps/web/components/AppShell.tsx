"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button, ThemeToggle } from "./ui";
import { NotificationsPopup } from "./NotificationsPopup";

const NAV = [
  { href: "/register", label: "登録" },
  { href: "/search", label: "探す" },
  { href: "/matches", label: "照合" },
  { href: "/admin", label: "管理" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [apiUnreachable, setApiUnreachable] = useState(false);
  const [aiMock, setAiMock] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasHealthIssue = apiUnreachable || aiMock;

  const refreshUnread = useCallback(() => {
    api.unreadCount().then(setUnread).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => api.unreadCount().then((c) => alive && setUnread(c)).catch(() => {});
    const loadHealth = () =>
      api
        .health()
        .then((h) => {
          if (!alive) return;
          setApiUnreachable(false);
          setAiMock(h.ai === "mock");
        })
        .catch(() => {
          if (!alive) return;
          setApiUnreachable(true);
          setAiMock(false);
        });
    load();
    loadHealth();
    const t = setInterval(() => {
      load();
      loadHealth();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  // メニュー外クリック / Escape で閉じる
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="rb-shell">
      <div className="rb-content">
        <header className="rb-topbar">
          <Link href="/" className="rb-brand">
            遺失物管理
          </Link>
          <nav className="rb-nav" aria-label="主要ナビゲーション">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? "active" : ""}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="rb-spacer" />

          <Button
            variant={hasHealthIssue ? "destructive" : unread > 0 ? "default" : "outline"}
            size="sm"
            onClick={() => setNotifOpen(true)}
            aria-label={
              hasHealthIssue
                ? "エラーがあります。通知を確認してください"
                : unread > 0
                  ? `未読の通知が${unread}件あります`
                  : "通知を見る"
            }
            aria-haspopup="dialog"
            title="通知を開く（今の画面のまま確認できます）"
          >
            🔔 通知{unread > 0 ? ` ${unread}` : ""}
          </Button>

          <div className="rb-menu-wrap" ref={menuRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="メニュー"
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              ☰
            </Button>
            {menuOpen && (
              <div className="rb-menu" role="menu">
                <span className="rb-menu__label">表示</span>
                <ThemeToggle />
                <span className="rb-menu__label">メニュー</span>
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} role="menuitem" onClick={() => setMenuOpen(false)}>
                    {n.label}
                  </Link>
                ))}
                <Link href="/admin#settings" role="menuitem" onClick={() => setMenuOpen(false)}>
                  設定
                </Link>
              </div>
            )}
          </div>
        </header>
        <main className="rb-main">{children}</main>
      </div>

      {/* 通知は画面遷移せずポップアップで確認（作業中の画面を失わない） */}
      <NotificationsPopup
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onChanged={refreshUnread}
        apiUnreachable={apiUnreachable}
        aiMock={aiMock}
      />
    </div>
  );
}
