import { useEffect, useState } from "react";
import { cn, colorFromString, initials } from "../lib/utils";

// ============================================================================
// PhotoAvatar — shows a staff photo from a Google Drive link (or any URL),
// falling back to colored initials if no photo / load error.
// ============================================================================

/** Convert any Google Drive share link into a direct-viewable image URL. */
export function resolveDriveImage(url: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  // Already a direct image URL
  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(trimmed)) return trimmed;
  // Drive "file/d/ID/view" or "open?id=ID" or "uc?id=ID"
  const m = trimmed.match(/[-\w]{25,}/);
  if (m && /drive\.google\.com|docs\.google\.com/i.test(trimmed)) {
    return `https://drive.google.com/thumbnail?id=${m[0]}&sz=s256`;
  }
  return trimmed;
}

export function PhotoAvatar({
  name, photoUrl, size = 40, className, ring = true,
}: { name: string; photoUrl?: string; size?: number; className?: string; ring?: boolean }) {
  const src = resolveDriveImage(photoUrl ?? "");
  const [ok, setOk] = useState<boolean>(!!src);

  useEffect(() => { setOk(!!src); }, [src]);

  const bg = colorFromString(name);
  if (src && ok) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        onError={() => setOk(false)}
        className={cn("shrink-0 rounded-full object-cover", ring && "ring-2 ring-white", className)}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", ring && "ring-2 ring-white", className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}
