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
 * ハッシュだけが変わる遷移を Next の App Router は onlyHashChange の早期リターンで
 * 処理し、URL の更新も history.pushState で行う（navigate-reducer.js / app-router.js）。
 * pushState は hashchange を発火しないので、すでに /admin にいる状態でメニューから
 * 別タブのリンクを押しても、ハッシュ監視だけではタブが切り替わらない。
 * 別ページからの遷移はマウント時にハッシュを読めば足りるが、同一ページ内は
 * このイベントで明示的に伝える必要がある。
 */
export const ADMIN_TAB_EVENT = "found:admin-tab";

export function requestAdminTab(tab: AdminTab) {
  window.dispatchEvent(new CustomEvent(ADMIN_TAB_EVENT, { detail: tab }));
}
