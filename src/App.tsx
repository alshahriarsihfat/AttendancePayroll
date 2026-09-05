import { AppProvider, useApp } from "./context/AppContext";
import { PinLogin } from "./components/PinLogin";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Staff } from "./pages/Staff";
import { Attendance } from "./pages/Attendance";
import { Leave } from "./pages/Leave";
import { Monitor } from "./pages/Monitor";
import { Payments } from "./pages/Payments";
import { PayslipView } from "./pages/PayslipView";
import { Settings } from "./pages/Settings";
import { Guide } from "./pages/Guide";
import { StaffTime } from "./pages/StaffTime";
import { ClockTerminal } from "./pages/ClockTerminal";

function Router() {
  const { view } = useApp();
  switch (view.page) {
    case "dashboard": return <Dashboard />;
    case "monitor": return <Monitor />;
    case "staff": return <Staff />;
    case "attendance": return <Attendance />;
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
  const { session, role, view, mustClockInFirst } = useApp();
  if (!session) return <PinLogin />;
  // Staff, and supervisors who haven't clocked in yet, get the full-screen clock terminal.
  if (role === "STAFF") return <ClockTerminal />;
  if (role === "SUPERVISOR" && (mustClockInFirst || view.page === "terminal")) return <ClockTerminal />;
  return (
    <Layout>
      <Router />
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
