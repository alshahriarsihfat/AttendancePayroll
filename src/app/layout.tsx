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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.iconify.design" />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}