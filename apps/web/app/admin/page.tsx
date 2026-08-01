"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { Button, Card, Select, Field, MetaOptionList } from "../../components/ui";
import { useMeta } from "../../components/useMeta";
import { useLocationPresets } from "../../components/useLocationPresets";
import { usePersistentState } from "../../components/usePersistentState";
import { ItemsTable } from "../../components/ItemsTable";
import { InquiriesTab } from "../../components/admin/InquiriesTab";
import { SettingsTab } from "../../components/admin/SettingsTab";
import { api } from "../../lib/api";
import { STATUS_LABEL, type Item } from "../../lib/types";

type Tab = "items" | "inquiries" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "items", label: "物品一覧" },
  { id: "inquiries", label: "問い合わせ" },
  { id: "settings", label: "設定" },
];
const ITEM_PAGE_SIZE = 100;

export default function AdminPage() {
  const meta = useMeta();
  const presets = useLocationPresets();
  const [tab, setTab] = usePersistentState<Tab>("admin:tab", "items");
  const [filters, setFilters] = usePersistentState("admin:filters", {
    category: "",
    status: "",
    location: "",
  });
  const [items, setItems] = useState<Item[]>([]);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const loadRequest = useRef(0);
  const currentCursor = cursorHistory[pageIndex] ?? null;

  const loadItems = useCallback(() => {
    const q: Record<string, string> = {};
    if (filters.category) q.category = filters.category;
    if (filters.status) q.status = filters.status;
    if (filters.location) q.location = filters.location;
    if (currentCursor) q.cursor = currentCursor;
    q.limit = String(ITEM_PAGE_SIZE);
    const requestId = ++loadRequest.current;
    setNextCursor(null);
    setItemsLoading(true);
    api
      .listItems(q)
      .then((page) => {
        if (requestId !== loadRequest.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === loadRequest.current) setItemsLoading(false);
      });
  }, [currentCursor, filters]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // 画像AI解析は登録後にバックグラウンドで進むため、解析待ちの行がある間だけ
  // 自動で再読込して進捗が見えるようにする（無くなれば止める）。
  useEffect(() => {
    if (!items.some((it) => it.ai_status === "pending")) return;
    const t = setInterval(loadItems, 5000);
    return () => clearInterval(t);
  }, [items, loadItems]);

  // ハッシュからのタブ遷移（ハンバーガーメニューの「設定」など）
  useEffect(() => {
    const fromHash = () => {
      const h = location.hash.replace("#", "") as Tab;
      if (TABS.some((t) => t.id === h)) setTab(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [setTab]);

  const csvHref = api.csvUrl(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>,
  );

  const printPdf = () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    window.open(`/print?${params}`, "_blank");
  };

  const updateFilter = (key: keyof typeof filters, value: string) => {
    loadRequest.current++;
    setCursorHistory([null]);
    setPageIndex(0);
    setNextCursor(null);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const showNextPage = () => {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((index) => index + 1);
    setNextCursor(null);
  };

  const showPreviousPage = () => {
    setPageIndex((index) => Math.max(0, index - 1));
    setNextCursor(null);
  };

  const selectTab = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `/admin#${t}`);
  };

  return (
    <AppShell>
      <div className="rb-between mb-16">
        <div>
          <h2>管理コンソール</h2>
        </div>
        <div className="rb-nav">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#${t.id}`}
              className={tab === t.id ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                selectTab(t.id);
              }}
            >
              {t.label}
            </a>
          ))}
        </div>
      </div>

      {tab === "items" && (
        <>
          <Card variant="bordered" className="mb-16 no-print">
            <div className="rb-grid rb-grid--3">
              <Field label="種別で絞込">
                {(id) => (
                  <Select
                    id={id}
                    value={filters.category}
                    onChange={(e) => updateFilter("category", e.target.value)}
                  >
                    <option value="">すべて</option>
                    <MetaOptionList options={meta.categories} />
                  </Select>
                )}
              </Field>
              <Field label="状態で絞込">
                {(id) => (
                  <Select
                    id={id}
                    value={filters.status}
                    onChange={(e) => updateFilter("status", e.target.value)}
                  >
                    <option value="">すべて</option>
                    {meta.itemStatuses.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="拾得場所">
                {(id) => (
                  <Select
                    id={id}
                    value={filters.location}
                    onChange={(e) => updateFilter("location", e.target.value)}
                  >
                    <option value="">すべて</option>
                    {presets.map((p) => (
                      <option key={p.name}>{p.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="rb-row">
              <Button variant="outline" onClick={loadItems}>
                再読込
              </Button>
              <Button onClick={printPdf}>PDF出力</Button>
              <a className="rb-btn rb-btn--outline" href={csvHref} target="_blank" rel="noreferrer">
                CSV出力
              </a>
              <span className="rb-tiny muted-text">
                {pageIndex + 1}ページ目・{items.length}件
              </span>
            </div>
          </Card>
          <ItemsTable items={items} meta={meta} onChanged={loadItems} />
          <div className="rb-between mt-16 no-print">
            <span className="rb-tiny muted-text">{pageIndex + 1}ページ目</span>
            <div className="rb-row">
              <Button
                variant="outline"
                disabled={pageIndex === 0 || itemsLoading}
                onClick={showPreviousPage}
              >
                前へ
              </Button>
              <Button
                variant="outline"
                disabled={!nextCursor || itemsLoading}
                onClick={showNextPage}
              >
                次へ
              </Button>
            </div>
          </div>
        </>
      )}

      {tab === "inquiries" && <InquiriesTab />}
      {tab === "settings" && <SettingsTab />}
    </AppShell>
  );
}
