import { useEffect, type ReactNode } from "react";
import { cn } from "../lib/utils";
import { IconButton } from "./ui";
import { Icon, type IconName } from "./icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
}

const SIZES = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export function Modal({ open, onClose, title, subtitle, icon, children, footer, size = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade" onClick={onClose} />
      {/* overflow-hidden + min-w-0 guarantees no horizontal leak on small screens */}
      <div className={cn("relative z-10 flex max-h-[92vh] w-full max-w-full min-w-0 flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl animate-scale-in sm:rounded-2xl", SIZES[size])}>
        {(title || icon) && (
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              {icon && (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon name={icon} size={18} />
                </span>
              )}
              <div className="min-w-0">
                {title && <h3 className="text-base font-semibold text-slate-900">{title}</h3>}
                {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</p>}
              </div>
            </div>
            <IconButton icon="x" label="Close" onClick={onClose} className="shrink-0" />
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger, icon = "alert",
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; icon?: IconName;
}) {
  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="flex gap-4">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", danger ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600")}>
          <Icon name={icon} size={22} />
        </span>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <div className="mt-1 text-sm text-slate-500">{message}</div>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={onClose}>Cancel</button>
        <button
          className={cn("inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm", danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700")}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
