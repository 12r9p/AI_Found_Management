"use client";
import { AppShell } from "../../../components/AppShell";
import { SettingsTab } from "../../../components/admin/SettingsTab";

export default function AdminSettingsPage() {
  return (
    <AppShell>
      <h2 className="mb-16">設定</h2>
      <SettingsTab />
    </AppShell>
  );
}
