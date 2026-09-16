
"use client";
import { AppProvider, useApp } from "./context/AppContext";
import { PinLogin } from "./components/PinLogin";
import { Layout } from "./components/Layout";
import { Dashboard } from "./reference-pages/Dashboard";
import { Staff } from "./reference-pages/Staff";
import { Attendance } from "./reference-pages/Attendance";
import { Leave } from "./reference-pages/Leave";
import { Monitor } from "./reference-pages/Monitor";
import { Payments } from "./reference-pages/Payments";
import { PayslipView } from "./reference-pages/PayslipView";
import { Settings } from "./reference-pages/Settings";
import { Guide } from "./reference-pages/Guide";
import { StaffTime } from "./reference-pages/StaffTime";
import { ClockTerminal } from "./reference-pages/ClockTerminal";
import { AttendanceHub } from "./reference-pages/AttendanceHub";

function Router() {
  const { view, role } = useApp();
  switch (view.page) {
    case "dashboard": return <Dashboard />;
    case "monitor": return <Monitor />;
    case "staff": return <Staff />;
    // Admins keep the historical Attendance report; supervisors get the
    // unified Attendance grid with in-place clock terminal controls.
    case "attendance": return role === "ADMIN" ? <Attendance /> : <AttendanceHub />;
    case "leave": return <Leave />;
    case "payments": return <Payments />;
    case "payslip": return <PayslipView />;
    case "settings": return <Settings />;
    case "guide": return <Guide />;
    case "stafftime": return <StaffTime />;
    case "terminal": return <ClockTerminal />;
    default: return <Dashboard />;
  }
}

function Shell() {
  const { session, hydrated, role } = useApp();
  if (!hydrated) return <div className="min-h-screen bg-page" aria-busy="true" />;
  if (!session) return <PinLogin />;
  // Staff are always routed to the full-screen clock terminal. Supervisors get
  // the app shell and manage clocking (their own + staff) from the unified
  // Attendance grid — no isolated single-user clock page.
  if (role === "STAFF") return <ClockTerminal />;
  return (
    <Layout>
      <Router />
    </Layout>
  );
}

export function AppContent() {
  return <Shell />;
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
