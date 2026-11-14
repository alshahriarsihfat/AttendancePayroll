import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockApp = {
  data: {
    sessions: [],
    payments: [],
    leaveRequests: [],
    leaveBalances: [],
    config: {},
  },
  todaySession: () => undefined,
  isOnLeaveToday: () => false,
  takeAdvance: vi.fn(),
  canPerm: () => true,
  navigate: vi.fn(),
};

vi.mock("../context/AppContext", () => ({
  useApp: () => mockApp,
}));

import { StaffDetailModal } from "./StaffDetailModal";
import type { Employee } from "../types";

const staff: Employee = {
  recordId: "rec_1",
  employeeId: "KP9801",
  username: "kp9801",
  password: "",
  fullName: "Test Staff",
  email: "",
  phone: "01767854321",
  department: "Unassigned",
  jobTitle: "Pharmacist",
  section: "Sales Floor",
  counter: null,
  joinDate: "2024-01-05",
  endDate: null,
  role: "STAFF",
  salaryType: "Hourly",
  baseSalary: 0,
  dailyRate: 0,
  hourlyRate: 60,
  dailyDutyHours: 8,
  workingDaysPerWeek: null,
  shiftStart: "09:00 AM",
  shiftEnd: "08:00 PM",
  mealBreakMin: 30,
  restMin: 15,
  photoUrl: "",
  status: "Active",
  isActive: true,
  arrears: 0,
  advance: 0,
};

beforeEach(() => {
  mockApp.canPerm = () => true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StaffDetailModal", () => {
  it("renders the profile with department and join date", () => {
    render(<StaffDetailModal staff={staff} open onClose={() => {}} />);
    expect(screen.getByText("Staff Profile")).toBeTruthy();
    expect(screen.getByText(/Pharmacist/)).toBeTruthy();
    expect(screen.getByText(/Unassigned/)).toBeTruthy();
    expect(screen.getByText("Employee ID")).toBeTruthy();
  });

  it("renders exactly the three remaining tabs and no Department/Responsibility tabs", () => {
    render(<StaffDetailModal staff={staff} open onClose={() => {}} />);
    const tabs = screen.getAllByRole("button").map((b) => b.textContent?.trim());
    expect(tabs).toContain("Attendance");
    expect(tabs).toContain("Payments");
    expect(tabs).toContain("Leave");
    expect(tabs.some((t) => /department/i.test(t ?? ""))).toBe(false);
    expect(tabs.some((t) => /responsibilit/i.test(t ?? ""))).toBe(false);
  });

  it("makes no API requests for removed Department/Responsibility modules", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const user = userEvent.setup();
    render(<StaffDetailModal staff={staff} open onClose={() => {}} />);

    await user.click(screen.getByRole("button", { name: /payments/i }));
    await user.click(screen.getByRole("button", { name: /leave/i }));
    await user.click(screen.getByRole("button", { name: /attendance/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the empty attendance state without errors", () => {
    render(<StaffDetailModal staff={staff} open onClose={() => {}} />);
    expect(screen.getByText(/No clock-in records yet/i)).toBeTruthy();
  });

  it("renders nothing when staff is null", () => {
    const { container } = render(<StaffDetailModal staff={null} open onClose={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});