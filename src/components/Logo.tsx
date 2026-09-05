import { useState } from "react";
import { cn } from "../lib/utils";

// ============================================================================
// Logo — loads the pharmacy logo from Google Drive, with a fallback to the
// bundled generated asset if the Drive image is blocked/unavailable.
// ============================================================================

/** Drive logo share link → direct thumbnail URL. */
const DRIVE_LOGO_URL =
  "https://drive.google.com/thumbnail?id=1j2R2tQ5PB2H1o_R2rqMDc70PqPUXUFMg&sz=s512";
const FALLBACK_LOGO = "/logo.png";

export function Logo({ className, size = 48 }: { className?: string; size?: number }) {
  const [src, setSrc] = useState(DRIVE_LOGO_URL);

  return (
    <img
      src={src}
      alt="AttendancePayroll"
      width={size}
      height={size}
      onError={() => { if (src !== FALLBACK_LOGO) setSrc(FALLBACK_LOGO); }}
      referrerPolicy="no-referrer"
      className={cn("rounded-xl object-cover ring-1 ring-black/5", className)}
      style={{ width: size, height: size }}
    />
  );
}
