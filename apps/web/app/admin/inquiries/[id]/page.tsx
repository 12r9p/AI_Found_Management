"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../../../components/AppShell";
import { FoundImage } from "../../../../components/FoundImage";
import { MatchReviewModal } from "../../../../components/MatchReviewModal";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  MetaOptionList,
  Select,
  Textarea,
  useConfirm,
  useToast,
} from "../../../../components/ui";
import { useMeta } from "../../../../components/useMeta";
import { api, isAppliedApiError } from "../../../../lib/api";
import { STATUS_LABEL, type Inquiry, type Match } from "../../../../lib/types";

type InquiryForm = Pick<
  Inquiry,
  "reference_no" | "status" | "category" | "color" | "description" | "notes" | "ai_description"
> & { tagsText: string };

function toForm(inquiry: Inquiry): InquiryForm {
  return {
    reference_no: inquiry.reference_no,
    status: inquiry.status,
    category: inquiry.category,
    color: inquiry.color,
    description: inquiry.description,
    notes: inquiry.notes,
    ai_description: inquiry.ai_description,
    tagsText: inquiry.tags.join("、"),
  };
}

function statusTone(status: Inquiry["status"]) {
  if (status === "resolved") return "success" as const;
  if (status === "contacted") return "info" as const;
  if (status === "open") return "warning" as const;
  return undefined;
}

export default function InquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const meta = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [form, setForm] = useState<InquiryForm | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reviewing, setReviewing] = useState<Match | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getInquiry(id);
      const enriched = await Promise.all(
        result.matches.map(async (match) => {
          try {
            const { item } = await api.getItem(match.item_id);
            return { ...match, item, inquiry: result.inquiry };
          } catch {
            return { ...match, inquiry: result.inquiry };
          }
        }),
      );
      setInquiry(result.inquiry);
      setForm(toForm(result.inquiry));
      setMatches(enriched);
    } catch (error) {
      toast(`問い合わせの読込に失敗しました: ${(error as Error).message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateForm = <K extends keyof InquiryForm>(key: K, value: InquiryForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    if (!inquiry || !form) return;
    setSaving(true);
    try {
      const { inquiry: updated } = await api.updateInquiry(inquiry.id, {
        reference_no: form.reference_no,
        status: form.status,
        category: form.category,
        color: form.color,
        description: form.description,
        notes: form.notes,
        ai_description: form.ai_description,
        tags: form.tagsText
          .split(/[、,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setInquiry(updated);
      setForm(toForm(updated));
      setMatches((current) => current.map((match) => ({ ...match, inquiry: updated })));
      setMode("view");
      toast("保存しました", "success");
    } catch (error) {
      if (isAppliedApiError(error)) {
        const updated = {
          ...inquiry,
          ...form,
          tags: form.tagsText
            .split(/[、,]/)
            .map((tag) => tag.trim())
            .filter(Boolean),
          updated_at: new Date().toISOString(),
        };
        setInquiry(updated);
        setMode("view");
        toast("保存内容は反映済みです。検索データの同期は保留中です", "success");
        return;
      }
      toast(`保存に失敗しました: ${(error as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!inquiry) return;
    const ok = await confirm({
      title: "問い合わせの削除",
      body: `受付No: ${inquiry.reference_no || "—"} の問い合わせを削除します。元に戻せません。`,
      danger: true,
      okLabel: "削除する",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteInquiry(inquiry.id);
      toast("削除しました", "success");
      router.push("/admin/inquiries");
    } catch (error) {
      toast(`削除に失敗しました: ${(error as Error).message}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  const rejectCandidate = async (match: Match) => {
    if (!inquiry) return;
    setSaving(true);
    try {
      const { inquiry: updated } = await api.updateMatch(match.id, "rejected");
      setInquiry(updated);
      setMatches((current) =>
        current.map((candidate) =>
          candidate.id === match.id
            ? { ...candidate, status: "rejected", inquiry: updated }
            : candidate,
        ),
      );
      toast("候補を不一致として処理しました", {
        tone: "success",
        action: {
          label: "やり直す",
          onClick: async () => {
            try {
              const { restored, inquiry: restoredInquiry } = await api.restoreRejectedMatches(
                inquiry.id,
                [match.id],
              );
              setInquiry(restoredInquiry);
              setMatches((current) =>
                current.map((candidate) =>
                  restored.includes(candidate.id)
                    ? { ...candidate, status: "pending", inquiry: restoredInquiry }
                    : candidate,
                ),
              );
              toast(
                restored.length
                  ? "不一致の処理を取り消しました"
                  : "候補は既に変更されているため取り消せません",
                restored.length ? "success" : "error",
              );
            } catch (error) {
              toast(`取り消しに失敗しました: ${(error as Error).message}`, "error");
            }
          },
        },
      });
    } catch (error) {
      if (isAppliedApiError(error)) {
        setMatches((current) =>
          current.map((candidate) =>
            candidate.id === match.id ? { ...candidate, status: "rejected" } : candidate,
          ),
        );
        toast("不一致の判断は反映済みです。検索データの同期は保留中です", "success");
        return;
      }
      toast(`更新に失敗しました: ${(error as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const rejectAllCandidates = async () => {
    if (!inquiry) return;
    const pending = matches.filter((match) => match.status === "pending");
    if (!pending.length) return;
    setSaving(true);
    try {
      const {
        rejected,
        rejectedMatchIds,
        inquiry: updated,
      } = await api.rejectPendingMatches(inquiry.id);
      setInquiry(updated);
      setMatches((current) =>
        current.map((candidate) =>
          rejectedMatchIds.includes(candidate.id)
            ? { ...candidate, status: "rejected", inquiry: updated }
            : candidate,
        ),
      );
      toast(`${rejected}件の候補を不一致として処理しました`, {
        tone: "success",
        action: {
          label: "やり直す",
          onClick: async () => {
            try {
              const { restored, inquiry: restoredInquiry } = await api.restoreRejectedMatches(
                inquiry.id,
                rejectedMatchIds,
              );
              setInquiry(restoredInquiry);
              setMatches((current) =>
                current.map((candidate) =>
                  restored.includes(candidate.id)
                    ? { ...candidate, status: "pending", inquiry: restoredInquiry }
                    : candidate,
                ),
              );
              toast(
                restored.length
                  ? `${restored.length}件の不一致処理を取り消しました`
                  : "候補は既に変更されているため取り消せません",
                restored.length ? "success" : "error",
              );
            } catch (error) {
              toast(`取り消しに失敗しました: ${(error as Error).message}`, "error");
            }
          },
        },
      });
    } catch (error) {
      if (isAppliedApiError(error)) {
        setMatches((current) =>
          current.map((candidate) =>
            candidate.status === "pending" ? { ...candidate, status: "rejected" } : candidate,
          ),
        );
        toast("不一致の判断は反映済みです。検索データの同期は保留中です", "success");
        return;
      }
      toast(`更新に失敗しました: ${(error as Error).message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !inquiry || !form) {
    return (
      <AppShell>
        <p className="rb-mono">読み込み中…</p>
      </AppShell>
    );
  }

  const confirmed = matches.find((match) => match.status === "confirmed");

  return (
    <AppShell>
      <div className="rb-between mb-16">
        <div>
          <div className="rb-eyebrow muted-text">問い合わせID: {inquiry.id.slice(0, 8)}</div>
          <h2>受付No: {inquiry.reference_no || "未設定"}</h2>
        </div>
        <Link className="rb-btn rb-btn--outline" href="/admin/inquiries">
          ← 一覧へ戻る
        </Link>
      </div>

      {mode === "view" ? (
        <>
          <div className="rb-between mb-16">
            <Badge tone={statusTone(inquiry.status)}>{STATUS_LABEL[inquiry.status]}</Badge>
            <Button onClick={() => setMode("edit")}>編集する</Button>
          </div>

          <div className="rb-grid rb-grid--2">
            <Card variant="bordered">
              <div className="rb-label mb-8">受付情報</div>
              <div className="rb-small">
                種別: {inquiry.category || "—"}
                <br />
                色: {inquiry.color || "—"}
                <br />
                状態: {STATUS_LABEL[inquiry.status]}
              </div>
              <div className="rb-label mt-16 mb-8">聞き取り内容</div>
              <p className="rb-small" style={{ margin: 0 }}>
                {inquiry.description || "—"}
              </p>
              <div className="rb-label mt-16 mb-8">メモ</div>
              <p className="rb-small" style={{ margin: 0 }}>
                {inquiry.notes || "—"}
              </p>
            </Card>

            <Card variant="muted">
              <div className="rb-label mb-8">解析・システム情報</div>
              <div className="rb-small">
                AI特徴文: {inquiry.ai_description || "—"}
                <br />
                タグ: {inquiry.tags.join(" / ") || "—"}
                <br />
                確定物品: {confirmed?.item?.display_id || inquiry.matched_item_id || "—"}
              </div>
              <div className="rb-tiny muted-text mt-16">
                登録: {new Date(inquiry.created_at).toLocaleString("ja-JP")}
                <br />
                更新: {new Date(inquiry.updated_at).toLocaleString("ja-JP")}
              </div>
            </Card>
          </div>

          <div className="rb-between mt-24 mb-8">
            <div className="rb-label">照合候補（{matches.length}件）</div>
            <div className="rb-row">
              <span className="rb-tiny muted-text">候補を選ぶと一致・不一致を判断できます。</span>
              {matches.some((match) => match.status === "pending") && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={rejectAllCandidates}
                  disabled={saving}
                >
                  全候補を不一致
                </Button>
              )}
            </div>
          </div>
          {matches.length === 0 ? (
            <Card variant="muted">
              <p className="rb-small" style={{ margin: 0 }}>
                一致する候補はまだありません。新しい遺失物が登録されると自動で照合されます。
              </p>
            </Card>
          ) : (
            <div className="rb-grid rb-grid--auto">
              {matches.map((match) => {
                const score = Math.round(match.score * 100);
                return (
                  <div key={match.id} className="rb-candidate-card">
                    <BaseButton
                      className="rb-card rb-card--interactive rb-interactive-card rb-candidate-card__detail"
                      onClick={() => setReviewing(match)}
                      aria-label={`${match.item?.display_id || "物品"}との照合候補を確認`}
                    >
                      <span className="rb-between mb-8">
                        <strong>{match.item?.display_id || "管理番号未設定"}</strong>
                        <Badge tone={score >= 60 ? "success" : "warning"}>{score}%</Badge>
                      </span>
                      {match.item?.image_keys?.[0] ? (
                        <FoundImage
                          imageKey={match.item.image_keys[0]}
                          variant="preview"
                          alt="候補の遺失物"
                          className="thumb mb-8"
                        />
                      ) : (
                        <span className="thumb thumb--empty mb-8">画像なし</span>
                      )}
                      <span className="rb-tiny muted-text" style={{ display: "block" }}>
                        {[match.item?.color, match.item?.category].filter(Boolean).join(" ") ||
                          "物品情報なし"}
                        <br />
                        {STATUS_LABEL[match.status]}
                      </span>
                    </BaseButton>
                    {match.status === "pending" && (
                      <div className="rb-candidate-card__action">
                        <Button
                          variant="destructive"
                          size="sm"
                          block
                          onClick={() => rejectCandidate(match)}
                          disabled={saving}
                        >
                          不一致
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <Card variant="bordered">
            <div className="rb-label mb-16">編集（手動で状態を変更できます）</div>
            <div className="rb-grid rb-grid--2">
              <Field label="受付番号（紙台帳）">
                {(fieldId) => (
                  <Input
                    id={fieldId}
                    value={form.reference_no}
                    onChange={(event) => updateForm("reference_no", event.target.value)}
                  />
                )}
              </Field>
              <Field label="状態">
                {(fieldId) => (
                  <Select
                    id={fieldId}
                    value={form.status}
                    onChange={(event) =>
                      updateForm("status", event.target.value as Inquiry["status"])
                    }
                  >
                    {meta.inquiryStatuses.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="種別">
                {(fieldId) => (
                  <Select
                    id={fieldId}
                    value={form.category}
                    onChange={(event) => updateForm("category", event.target.value)}
                  >
                    <option value="">未設定</option>
                    <MetaOptionList options={meta.categories} />
                  </Select>
                )}
              </Field>
              <Field label="色">
                {(fieldId) => (
                  <Select
                    id={fieldId}
                    value={form.color}
                    onChange={(event) => updateForm("color", event.target.value)}
                  >
                    <option value="">未設定</option>
                    <MetaOptionList options={meta.colors} />
                  </Select>
                )}
              </Field>
            </div>
            <Field label="聞き取り内容" hint="保存後の照合に反映されます">
              {(fieldId) => (
                <Textarea
                  id={fieldId}
                  value={form.description}
                  onChange={(event) => updateForm("description", event.target.value)}
                />
              )}
            </Field>
            <Field label="メモ" hint="個人情報は入力しないでください">
              {(fieldId) => (
                <Textarea
                  id={fieldId}
                  value={form.notes}
                  onChange={(event) => updateForm("notes", event.target.value)}
                />
              )}
            </Field>
            <Field label="AI特徴文">
              {(fieldId) => (
                <Textarea
                  id={fieldId}
                  value={form.ai_description}
                  onChange={(event) => updateForm("ai_description", event.target.value)}
                />
              )}
            </Field>
            <Field label="タグ" hint="読点またはカンマ区切り">
              {(fieldId) => (
                <Input
                  id={fieldId}
                  value={form.tagsText}
                  onChange={(event) => updateForm("tagsText", event.target.value)}
                />
              )}
            </Field>
          </Card>

          <div className="rb-between mt-16">
            <Button variant="destructive" onClick={remove} disabled={saving || deleting}>
              {deleting ? "削除中…" : "削除"}
            </Button>
            <div className="rb-row">
              <Button
                variant="outline"
                onClick={() => {
                  setForm(toForm(inquiry));
                  setMode("view");
                }}
                disabled={saving || deleting}
              >
                取消
              </Button>
              <Button onClick={save} disabled={saving || deleting}>
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </>
      )}

      <MatchReviewModal
        match={reviewing}
        context="管理 › 問い合わせ › 照合候補"
        onClose={() => setReviewing(null)}
        onDecided={({ inquiry: updated, match }) => {
          setInquiry(updated);
          setMatches((current) =>
            current.map((candidate) =>
              candidate.id === match.id ? { ...candidate, ...match, inquiry: updated } : candidate,
            ),
          );
        }}
      />
    </AppShell>
  );
}
