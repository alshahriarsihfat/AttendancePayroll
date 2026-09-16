import type { Metadata } from "next";
import "../index.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "KPSMS",
  description: "Khan Pharmacy Staff Management System",
  icons: {
    icon: "https://api.iconify.design/mdi:account-group-outline.svg?color=%230d9488",
    shortcut: "https://api.iconify.design/mdi:account-group-outline.svg?color=%230d9488",
    apple: "https://api.iconify.design/mdi:account-group-outline.svg?color=%230d9488",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://api.iconify.design" />
        {/* Dark-mode boot: apply the persisted theme (or system preference on
            first load) before first paint so there is no flash of the wrong
            scheme. ThemeToggle writes the same localStorage key. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("kpsms-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}