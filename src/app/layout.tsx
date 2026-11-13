import type { Metadata } from "next";
import Script from "next/script";
import "../index.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "KPSMS",
  description: "Khan Pharmacy Staff Management System",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark-mode boot: apply the persisted theme (or system preference on
            first load) before first paint so there is no flash of the wrong
            scheme. ThemeToggle writes the same localStorage key. */}
        <Script
          id="kpsms-theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("kpsms-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}