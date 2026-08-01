"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
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
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm";
  block?: boolean;
}) {
  return (
    <button
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
  size,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** 呼び出し元の画面名。「どこから開いたか」を示して階層を意識させる。 */
  context?: string;
  size?: "wide" | "full";
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // onClose は呼び出し側で毎レンダー新しい関数になりがち（インライン定義）。
  // 依存配列に入れると、モーダル内で入力するたびに呼び出し元が再レンダーされ
  // このeffectが再実行されてフォーカスを奪い返してしまう（1文字も打てなくなるバグの原因）。
  // ref 経由で最新の onClose を参照し、effect 自体は open が変わった時だけ走らせる。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    // モーダル表示中は背後をスクロールさせない（元画面が動くと階層が曖昧になる）
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 開いた直後にモーダル内へフォーカスを移す
    requestAnimationFrame(() => bodyRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="rb-overlay" onClick={onClose}>
      <div
        className={cx("rb-modal", size && `rb-modal--${size}`)}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rb-modal__head">
          <span className="rb-modal__title">
            {context && <span className="rb-modal__ctx">{context} ›</span>}[{title}]
          </span>
          <button className="rb-modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="rb-modal__body" ref={bodyRef} tabIndex={-1}>
          {children}
        </div>
        {footer && <div className="rb-modal__foot">{footer}</div>}
      </div>
    </div>
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

  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
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
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const saved = (localStorage.getItem("rb-theme") as "light" | "dark") || null;
    if (saved) {
      document.documentElement.setAttribute("data-theme", saved);
      setTheme(saved);
    } else {
      setTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("rb-theme", next);
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
