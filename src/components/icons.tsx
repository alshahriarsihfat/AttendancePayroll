import type { ReactNode, SVGProps } from "react";

// Compact inline icon set (Lucide-style geometry). No external dependency.
const P: Record<string, ReactNode> = {
  dashboard: (<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-3-3.87" /><path d="M8 21v-2a4 4 0 0 1 4-4h0" /><circle cx="9" cy="7" r="3.2" /><path d="M17 11a3 3 0 1 0-1-5.83" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>),
  user: (<><circle cx="12" cy="8" r="3.6" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>),
  calendar: (<><rect x="3" y="4.5" width="18" height="17" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>),
  wallet: (<><path d="M19 8V6a2 2 0 0 0-2-2H5.5a1.5 1.5 0 0 0 0 3H20a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6" /><circle cx="16.5" cy="14" r="1.2" /></>),
  receipt: (<><path d="M5 3v18l2.2-1.4L9.5 21l2.2-1.4L14 21l2.2-1.4L18.5 21V3l-2.3 1.4L14 3l-2.3 1.4L9.5 3 7.3 4.4 5 3Z" /><path d="M9 9h6M9 13h6" /></>),
  chart: (<><path d="M3 3v18h18" /><rect x="7" y="11" width="3" height="6" rx="0.5" /><rect x="12.5" y="7" width="3" height="10" rx="0.5" /><rect x="18" y="13" width="0.01" /></>),
  shield: <path d="M12 22s8-4 8-10V5.5L12 2 4 5.5V12c0 6 8 10 8 10Z" />,
  shieldCheck: (<><path d="M12 22s8-4 8-10V5.5L12 2 4 5.5V12c0 6 8 10 8 10Z" /><path d="m9 11.5 2 2 4-4" /></>),
  settings: (<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><circle cx="4" cy="13.5" r="2" /><circle cx="12" cy="6.5" r="2" /><circle cx="20" cy="14.5" r="2" /></>),
  list: (<><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>),
  search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  plus: <path d="M12 5v14M5 12h14" />,
  pencil: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  trash: (<><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6M14 11v6" /></>),
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  logout: (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>),
  mail: (<><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><path d="m3 6 9 6 9-6" /></>),
  download: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>),
  lock: (<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  play: <path d="M6 4v16l13-8L6 4Z" />,
  alert: (<><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" /><path d="M12 9v5M12 17.5h.01" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>),
  trendUp: (<><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>),
  building: (<><path d="M3 21h18M6 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" /><path d="M16 21V9h2a2 2 0 0 1 2 2v10" /><path d="M9 7h2M9 11h2M9 15h2" /></>),
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9Z" />,
  idcard: (<><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5.5 16a2.6 2.6 0 0 1 5 0M14 10h5M14 13.5h5" /></>),
  banknote: (<><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: (<><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="m2 2 20 20" /></>),
  filter: <path d="M22 4H2l8 9.5V20l4-2v-4.5L22 4Z" />,
  print: (<><path d="M6 9V3h12v6" /><path d="M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1" /><rect x="6" y="15" width="12" height="6" rx="1" /></>),
  refresh: (<><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></>),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  sparkle: <path d="m12 3 1.9 5.8L19.7 10.7l-5.8 1.9L12 18.4l-1.9-5.8L4.3 10.7l5.8-1.9L12 3Z" />,
  briefcase: (<><rect x="2.5" y="7.5" width="19" height="13" rx="2" /><path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5M2.5 12.5h19" /></>),
  flag: (<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1v11Z" /><path d="M4 22v-7" /></>),
  arrowRight: (<><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>),
  fileText: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>),
  calculator: (<><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h4" /></>),
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />,
  pause: (<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>),
  meal: (<><path d="M3 11h18M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M4 11l1 9h14l1-9" /><path d="M9 2v2M12 2v2M15 2v2" /></>),
  coffee: (<><path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16M7 3v2M11 3v2" /><path d="M3 21h16" /></>),
  power: (<><path d="M12 3v8" /><path d="M6.4 6.4a8 8 0 1 0 11.2 0" /></>),
  timer: (<><circle cx="12" cy="13" r="8" /><path d="M12 13V9M9 2h6" /></>),
  users2: (<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5M17 20a6 6 0 0 0-3-5.2" /></>),
  handCoin: (<><circle cx="16" cy="12" r="2.5" /><path d="M3 14h4l3 2h3a1.5 1.5 0 0 1 0 3H8M3 14v5M16.5 9.7A2.5 2.5 0 1 1 19 12" /></>),
  pin: (<><path d="M12 2 8 6h2v5l-3 7a1 1 0 0 0 1 1.3l4-2 4 2a1 1 0 0 0 1-1.3l-3-7V6h2l-4-4Z" /></>),
  pill: (<><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(45 12 12)" /><path d="m9 9 6 6" /></>),
  store: (<><path d="M3 9 4.5 4h15L21 9M4 9v11h16V9M4 9h16" /><path d="M9 20v-5h6v5" /></>),
  heart: <path d="M12 20s-7-4.35-9.5-9a5.5 5.5 0 0 1 9.5-5 5.5 5.5 0 0 1 9.5 5C19 15.65 12 20 12 20Z" />,
  candle: (<><path d="M12 3v2M12 13a4 4 0 0 0 0-8 4 4 0 0 0 0 8Z" /><path d="M9 13h6l-1 8H10l-1-8Z" /></>),
};

export type IconName = keyof typeof P;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, ...rest }: IconProps & { strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {P[name]}
    </svg>
  );
}
