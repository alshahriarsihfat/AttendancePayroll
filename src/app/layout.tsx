import type { Metadata } from "next";
import "../index.css";

export const metadata: Metadata = {
  title: "AttendancePayroll",
  description: "Staff attendance and payroll management",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}