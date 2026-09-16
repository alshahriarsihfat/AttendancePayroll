import { Modal } from "./Modal";
import { Button } from "./ui";
import { Icon } from "./icons";
import { formatDuration, formatLongDuration } from "../lib/dates";

/** Motivation / praise / warning modal shown on clock-in events. */
export function ClockInModal({
  open, onClose, kind, quote, minutes,
}: {
  open: boolean;
  onClose: () => void;
  kind: "quote" | "praise" | "late" | "early";
  quote?: string;
  minutes?: number;
}) {
  const tone =
    kind === "late" || kind === "early"
      ? { ring: "ring-amber-200 dark:ring-amber-400/30", bg: "bg-amber-50 dark:bg-amber-500/15", text: "text-amber-700 dark:text-amber-300", icon: "alert" as const }
      : kind === "praise"
      ? { ring: "ring-emerald-200 dark:ring-emerald-400/30", bg: "bg-emerald-50 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", icon: "sparkle" as const }
      : { ring: "ring-primary/25", bg: "bg-primary-soft", text: "text-primary", icon: "heart" as const };

  const isClockOut = kind === "praise" || kind === "early";

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="text-center">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${tone.bg} ${tone.text} ring-4 ${tone.ring} ring-inset`}>
          <Icon name={tone.icon} size={28} />
        </span>

        {kind === "quote" && (
          <>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-primary">Today's Motivation</p>
            <p className="mt-2 text-lg font-semibold leading-relaxed text-foreground">“{quote}”</p>
            <p className="mt-3 text-sm text-faint-foreground">A great shift starts with a caring heart. 💚</p>
          </>
        )}

        {kind === "praise" && (
          <>
            <p className="mt-4 text-xl font-bold text-emerald-600">Thank You!</p>
            <p className="mt-1 text-base font-medium text-foreground">{quote ?? "Thank you for your dedicated service today."}</p>
            <p className="mt-2 text-sm text-faint-foreground">You clocked out right on time. See you next shift!</p>
          </>
        )}

        {kind === "late" && (
          <>
            <p className="mt-4 text-xl font-bold text-amber-600">Warning — Late Arrival</p>
            <p className="mt-1 text-base font-medium text-foreground">You were <b>{formatLongDuration(minutes ?? 0)}</b> late checking in today.</p>
            <p className="mt-2 text-sm text-faint-foreground">Please aim to arrive on time for your next shift.</p>
          </>
        )}

        {kind === "early" && (
          <>
            <p className="mt-4 text-xl font-bold text-amber-600">Warning — Early Departure</p>
            <p className="mt-1 text-base font-medium text-foreground">You left <b>{formatLongDuration(minutes ?? 0)}</b> before your scheduled shift end.</p>
            <p className="mt-2 text-sm text-faint-foreground">Early departures are logged. Please complete your full shift next time.</p>
          </>
        )}

        <Button className="mt-6 w-full" icon={isClockOut ? "check" : "power"} onClick={onClose}>{isClockOut ? "Done" : "Start Shift"}</Button>
      </div>
    </Modal>
  );
}

/** Clock-out confirmation — surfaces any early-departure warning before ending the shift. */
export function ClockOutConfirm({
  open, onClose, onConfirm, earlyMin,
}: { open: boolean; onClose: () => void; onConfirm: () => void; earlyMin: number }) {
  const isEarly = earlyMin >= 10;
  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="text-center">
        <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-4 ring-inset ${isEarly ? "bg-amber-50 text-amber-600 ring-amber-200" : "bg-emerald-50 text-emerald-600 ring-emerald-200"}`}>
          <Icon name="power" size={26} />
        </span>
        <h3 className="mt-4 text-lg font-bold text-foreground">Clock out now?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {isEarly
            ? `Your shift isn't scheduled to end for another ${formatLongDuration(earlyMin)}. Clocking out now will record an early departure.`
            : "This will end your active shift and start the countdown to your next one."}
        </p>
        {isEarly && (
          <p className="mt-3 inline-block rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
            ⚠️ Early departure — {formatDuration(earlyMin)} before shift end
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant={isEarly ? "danger" : "primary"} icon="power" className="flex-1" onClick={onConfirm}>Clock Out</Button>
        </div>
      </div>
    </Modal>
  );
}
