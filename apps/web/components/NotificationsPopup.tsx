"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Modal, useToast } from "./ui";
import { api, imageUrl } from "../lib/api";
import type { Notification } from "../lib/types";

/**
 * 通知ポップアップ。
 * ベルで画面遷移すると「戻る」で元の作業に戻れず履歴が分かりにくくなるため、
 * 今いる画面の上に重ねて表示する。関連先へ進むときだけ実際に遷移する。
 */
export function NotificationsPopup({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [showRead, setShowRead] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .notifications()
      .then(setNotifs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const unread = notifs.filter((n) => !n.read);
  const shown = showRead ? notifs : unread;

  const markRead = async (n: Notification) => {
    if (n.read) return;
    await api.markRead(n.id);
    setNotifs((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    onChanged();
  };

  const markAll = async () => {
    await Promise.all(unread.map((n) => api.markRead(n.id)));
    toast(`${unread.length}件を既読にしました`, "success");
    load();
    onChanged();
  };

  /** 関連先へ移動。移動時は既読にし、ポップアップを閉じる。 */
  const goTo = async (n: Notification, href: string) => {
    await markRead(n);
    onClose();
    router.push(href);
  };

  return (
    <Modal
      open={open}
      title="通知"
      context="全画面共通"
      size="wide"
      onClose={onClose}
      footer={
        <>
          {unread.length > 0 && (
            <Button variant="outline" onClick={markAll}>
              すべて既読にする（{unread.length}）
            </Button>
          )}
          <Button onClick={onClose}>閉じる</Button>
        </>
      }
    >
      <div className="rb-between mb-16">
        <span className="rb-eyebrow">
          未読 {unread.length} 件 / 全 {notifs.length} 件
        </span>
        <div className="rb-row" style={{ gap: 6 }}>
          <Button variant="ghost" size="sm" onClick={load}>
            再読込
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowRead((v) => !v)}>
            {showRead ? "未読のみ表示" : "既読も表示"}
          </Button>
        </div>
      </div>

      {loading && (
        <div className="rb-busy" role="status" aria-live="polite">
          <span className="rb-spinner" aria-hidden />
          <span>読み込み中…</span>
        </div>
      )}

      {!loading && shown.length === 0 && (
        <Card variant="muted">
          <p className="rb-small" style={{ margin: 0 }}>
            {showRead ? "通知はありません。" : "未読の通知はありません。"}
          </p>
        </Card>
      )}

      <div className="rb-col">
        {shown.map((n) => (
          <Card key={n.id} variant={n.read ? "muted" : "bordered"}>
            <div className="rb-between mb-8">
              <strong>{n.title}</strong>
              {n.read ? <Badge>既読</Badge> : <Badge tone="warning">未読</Badge>}
            </div>
            <p className="rb-small" style={{ margin: 0 }}>{n.body}</p>
            <div className="rb-row mt-8">
              {n.ref_match_id && (
                <Button size="sm" onClick={() => goTo(n, `/matches?open=${n.ref_match_id}`)}>
                  突き合わせを確認 →
                </Button>
              )}
              {n.ref_item_id && (
                <Button size="sm" variant="outline" onClick={() => goTo(n, `/items/${n.ref_item_id}`)}>
                  該当の物品を見る →
                </Button>
              )}
              {!n.read && (
                <Button size="sm" variant="ghost" onClick={() => markRead(n)}>
                  既読にする
                </Button>
              )}
              <span className="rb-spacer" />
              <span className="rb-tiny muted-text">
                {new Date(n.created_at).toLocaleString("ja-JP")}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </Modal>
  );
}
