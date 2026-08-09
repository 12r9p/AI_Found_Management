"use client";
import { AppShell } from "../../../components/AppShell";
import { InquiriesTab } from "../../../components/admin/InquiriesTab";

export default function AdminInquiriesPage() {
  return (
    <AppShell>
      <h2 className="mb-16">問い合わせ</h2>
      <InquiriesTab />
    </AppShell>
  );
}
