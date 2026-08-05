export type AdminTab = "items" | "inquiries" | "settings";

/** 管理コンソールのタブ。ヘッダーのメニューと管理ページの両方が参照する。 */
export const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: "items", label: "物品一覧" },
  { id: "inquiries", label: "問い合わせ" },
  { id: "settings", label: "設定" },
];

export const isAdminTab = (value: string): value is AdminTab =>
  ADMIN_TABS.some((t) => t.id === value);

export const adminTabHref = (tab: AdminTab) => `/admin#${tab}`;

/**
 * メニューから管理ページへ「このタブを開け」と伝えるためのイベント名。
 *
 * App Router は URL の更新を history.pushState で行い（app-router.js）、pushState は
 * hashchange を発火しない。そのため、すでに /admin にいる状態でメニューから別タブの
 * リンクを押しても、ハッシュ監視だけではタブが切り替わらない。
 * 実測（Next 16.2.12）: /admin#items → /admin#settings の遷移で hashchange は0回。
 *
 * 別ページからの遷移はマウント時にハッシュを読めば足りるので、同一ページ内の
 * 切替だけをこのイベントで明示的に伝える。
 */
export const ADMIN_TAB_EVENT = "found:admin-tab";

export function requestAdminTab(tab: AdminTab) {
  window.dispatchEvent(new CustomEvent(ADMIN_TAB_EVENT, { detail: tab }));
}
