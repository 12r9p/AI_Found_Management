"use client";
import { Button as BaseButton } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { useTheme } from "next-themes";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { MetaOption } from "../lib/types";

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

// ---------------- Button ----------------
type BtnVariant = "default" | "outline" | "secondary" | "destructive" | "ghost";
export function Button({
  variant = "default",
  size,
  block,
  className,
  ...props
}: Omit<React.ComponentProps<typeof BaseButton>, "className"> & {
  variant?: BtnVariant;
  size?: "sm";
  block?: boolean;
  className?: string;
}) {
  return (
    <BaseButton
      className={cx(
        "rb-btn",
        variant !== "default" && `rb-btn--${variant}`,
        size === "sm" && "rb-btn--sm",
        block && "rb-btn--block",
        className,
      )}
      {...props}
    />
  );
}

// ---------------- Field wrapper ----------------
export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="rb-field">
      <label className="rb-label" htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden>
            *
          </span>
        )}
      </label>
      {children(id)}
      {hint && !error && <span className="rb-hint">{hint}</span>}
      {error && <span className="rb-error-text">{error}</span>}
    </div>
  );
}

// ---------------- Inputs ----------------
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cx("rb-input", invalid && "rb-input--error", className)}
      {...props}
    />
  );
});

export function Textarea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cx("rb-textarea", invalid && "rb-textarea--error", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("rb-select", className)} {...props}>
      {children}
    </select>
  );
}

/** 種別・色などの選択肢を <option> として並べる。group が付いたものは <optgroup> でまとめる
 * （無所属のものは見出し無しでそのまま先頭に並べる）。color があれば option の背景に軽く反映する。 */
export function MetaOptionList({ options }: { options: MetaOption[] }) {
  const ungrouped = options.filter((o) => !o.group);
  const groups = new Map<string, MetaOption[]>();
  for (const o of options) {
    if (!o.group) continue;
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group)!.push(o);
  }
  const optionEl = (o: MetaOption) => (
    <option key={o.name} value={o.name} style={o.color ? { backgroundColor: o.color } : undefined}>
      {o.name}
    </option>
  );
  return (
    <>
      {ungrouped.map(optionEl)}
      {Array.from(groups.entries()).map(([group, opts]) => (
        <optgroup key={group} label={group}>
          {opts.map(optionEl)}
        </optgroup>
      ))}
    </>
  );
}

/** 色の丸スウォッチ。color 未設定なら何も描かない。 */
export function ColorSwatch({ color, size = 12 }: { color?: string; size?: number }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: "1px solid var(--border)",
        flexShrink: 0,
      }}
    />
  );
}

// ---------------- Badge ----------------
export function Badge({
  children,
  tone,
  fill,
}: {
  children: React.ReactNode;
  tone?: "success" | "warning" | "error" | "info";
  fill?: boolean;
}) {
  return (
    <span className={cx("rb-badge", fill && "rb-badge--fill", tone && `rb-badge--${tone}`)}>
      {children}
    </span>
  );
}

// ---------------- Card ----------------
export function Card({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "interactive" | "bordered" | "elevated" | "muted";
}) {
  return (
    <div
      className={cx("rb-card", variant !== "default" && `rb-card--${variant}`, className)}
      {...props}
    />
  );
}

// ---------------- Modal ----------------
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  context,
  description,
  size,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 呼び出し元の画面名。「どこから開いたか」を示して階層を意識させる。 */
  context?: string;
  /** 支援技術がダイアログの目的を読み上げるための説明。 */
  description?: string;
  size?: "wide" | "full";
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="rb-overlay" />
        <Dialog.Viewport className="rb-dialog-viewport">
          <Dialog.Popup
            className={cx("rb-modal", size && `rb-modal--${size}`)}
            initialFocus={bodyRef}
            finalFocus
          >
            <div className="rb-modal__head">
              <Dialog.Title className="rb-modal__title">
                {context && <span className="rb-modal__ctx">{context} ›</span>}[{title}]
              </Dialog.Title>
              <Dialog.Close className="rb-modal__close" aria-label="閉じる">
                ×
              </Dialog.Close>
            </div>
            <Dialog.Description className="rb-visually-hidden">
              {description ?? `${title}の内容を確認し、必要な操作を行います。`}
            </Dialog.Description>
            <div className="rb-modal__body" ref={bodyRef} tabIndex={-1}>
              {children}
            </div>
            {footer && <div className="rb-modal__foot">{footer}</div>}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------- Confirm dialog (window.confirm 代替) ----------------
type ConfirmOpts = { title?: string; body: string; danger?: boolean; okLabel?: string };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

// ---------------- Toast ----------------
type ToastTone = "success" | "error";
/** トーストに添えるアクション（取り消す / 編集する など）。 */
export interface ToastOpts {
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** 表示時間(ms)。アクション付きは既定で長め。 */
  duration?: number;
}
type Toast = { id: number; msg: string } & ToastOpts;

type ToastFn = (msg: string, opts?: ToastTone | ToastOpts) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback<ToastFn>((msg, opts) => {
    // 旧シグネチャ toast(msg, "success") も受ける
    const o: ToastOpts = typeof opts === "string" ? { tone: opts } : (opts ?? {});
    const id = Date.now() + Math.random();
    // 誤操作のリカバリ用アクションは押す時間が要るので長めに出す
    const ms = o.duration ?? (o.action ? 10000 : 4000);
    setToasts((t) => [...t, { id, msg, ...o }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const [confirmState, setConfirmState] = useState<
    (ConfirmOpts & { resolve: (v: boolean) => void }) | null
  >(null);
  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  );
  const settle = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };
  const toastViewport = (
    <div className="rb-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("rb-toast", t.tone && `rb-toast--${t.tone}`)}>
          <span className="rb-toast__msg">{t.msg}</span>
          {t.action && (
            <button
              className="rb-toast__action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        {mounted && createPortal(toastViewport, document.body)}
        <Modal
          open={!!confirmState}
          title={confirmState?.title ?? "確認"}
          onClose={() => settle(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => settle(false)}>
                キャンセル
              </Button>
              <Button
                variant={confirmState?.danger ? "destructive" : "default"}
                onClick={() => settle(true)}
              >
                {confirmState?.okLabel ?? "OK"}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{confirmState?.body}</p>
        </Modal>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

// ---------------- Theme toggle ----------------
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const theme = mounted ? resolvedTheme : null;
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  };
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      aria-label="テーマ切替"
      title="ライト/ダーク切替"
    >
      {theme === "dark" ? "☀ LIGHT" : "☾ DARK"}
    </Button>
  );
}
