import { useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { cn } from "../lib/utils";

/** A copy-to-clipboard code block with a filename header. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-700/60 bg-slate-800/60 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Icon name="fileText" size={13} /> {label ?? "code"}
        </span>
        <button
          onClick={copy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition",
            copied ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-200 hover:bg-slate-600"
          )}
        >
          <Icon name={copied ? "check" : "download"} size={13} />
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[460px] overflow-auto p-4 text-[12.5px] leading-relaxed">
        <code className="font-mono text-slate-200">{code}</code>
      </pre>
    </div>
  );
}

export function Callout({ tone = "indigo", icon, title, children }: { tone?: "indigo" | "emerald" | "amber" | "rose"; icon?: ReactNode; title?: string; children: ReactNode }) {
  const c = {
    indigo: "border-primary/20 bg-primary-soft text-primary dark:bg-primary-soft/70",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/25",
    amber: "border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/25",
    rose: "border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/25",
  }[tone];
  return (
    <div className={cn("rounded-2xl border p-4", c)}>
      {title && <p className="flex items-center gap-1.5 text-sm font-semibold">{icon}{title}</p>}
      <div className="mt-1 text-sm leading-relaxed opacity-90">{children}</div>
    </div>
  );
}
