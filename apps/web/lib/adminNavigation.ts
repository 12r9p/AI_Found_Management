export const ADMIN_NAV = [
  { href: "/admin", label: "物品一覧" },
  { href: "/admin/inquiries", label: "問い合わせ" },
  { href: "/admin/settings", label: "設定" },
] as const;

/** `/admin` が配下の全ページで選択状態にならないよう、管理ナビはURL単位で判定する。 */
export function isAdminNavActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
}
