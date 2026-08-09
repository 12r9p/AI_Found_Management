import { expect, test } from "bun:test";
import { ADMIN_NAV, isAdminNavActive } from "./adminNavigation";

test("管理機能はハッシュではなく独立URLを持つ", () => {
  expect(ADMIN_NAV).toEqual([
    { href: "/admin", label: "物品一覧" },
    { href: "/admin/inquiries", label: "問い合わせ" },
    { href: "/admin/settings", label: "設定" },
  ]);
  expect(ADMIN_NAV.every(({ href }) => !href.includes("#") && !href.includes("?"))).toBe(true);
});

test("管理ナビは現在のページだけを選択状態にする", () => {
  expect(isAdminNavActive("/admin", "/admin")).toBe(true);
  expect(isAdminNavActive("/admin/inquiries", "/admin")).toBe(false);
  expect(isAdminNavActive("/admin/inquiries", "/admin/inquiries")).toBe(true);
  expect(isAdminNavActive("/admin/settings/detail", "/admin/settings")).toBe(true);
});
