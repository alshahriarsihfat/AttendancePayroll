import type { ConfigEntry, TaxSlab } from "../types";

// ============================================================================
// Khan Pharmacy — business rules config.
// ============================================================================

export const REGION = "Bangladesh";
export const CURRENCY_CODE = "BDT";
export const CURRENCY_SYMBOL = "৳";

/** Global Live-Floor tracking window. */
export const FLOOR_OPEN = "09:00 AM";
export const FLOOR_CLOSE = "11:00 PM";

/** Number of supported Pharmacy Counters. */
export const COUNTER_COUNT = 9;
export const COUNTER_NUMBERS = Array.from({ length: COUNTER_COUNT }, (_, i) => i + 1);

export const DEFAULT_CONFIG: ConfigEntry[] = [
  { key: "ORG_NAME", value: "Khan Pharmacy", description: "Pharmacy / business name shown across the app.", category: "General" },
  { key: "ORG_ADDRESS", value: "Gulshan Avenue, Dhaka 1212, Bangladesh", description: "Pharmacy address printed on payslips.", category: "Payslip" },
  { key: "ORG_PHONE", value: "+880 1711 000 020", description: "Pharmacy phone printed on payslips.", category: "Payslip" },
  { key: "ORG_EMAIL", value: "info@khanpharmacy.bd", description: "Pharmacy email printed on payslips.", category: "Payslip" },
  { key: "ORG_LICENSE", value: "DRUG-LIC-DHA-1998-0420", description: "Drug licence number printed on payslips.", category: "Payslip" },
  { key: "PAYSPLIT_FOOTER", value: "This is a computer-generated payslip and does not require a signature.", description: "Footer note printed at the bottom of payslips.", category: "Payslip" },
  { key: "CURRENCY_SYMBOL", value: "৳", description: "Symbol shown beside money figures.", category: "General" },
  { key: "CURRENCY_DECIMAL_PLACES", value: "2", description: "Decimals for the single rounding function.", category: "General" },
  { key: "FLOOR_OPEN_TIME", value: FLOOR_OPEN, description: "Live-floor tracking opens at this time.", category: "Attendance" },
  { key: "FLOOR_CLOSE_TIME", value: FLOOR_CLOSE, description: "Live-floor tracking closes at this time.", category: "Attendance" },
  { key: "MEAL_BREAK_MINUTES", value: "30", description: "Paid meal-break allowance. Over this is deducted.", category: "Attendance" },
  { key: "REST_BREAK_MINUTES", value: "15", description: "Paid rest-break allowance. Over this is deducted.", category: "Attendance" },
  { key: "LATE_GRACE_MINUTES", value: "10", description: "Minutes late before a warning/approval is triggered.", category: "Attendance" },
  { key: "EARLY_CHECKIN_MINUTES", value: "5", description: "Staff may clock in at most this many minutes before shift start.", category: "Attendance" },
  { key: "AUTO_CLOCKOUT_MINUTES", value: "15", description: "Auto clock-out this many minutes after scheduled shift end.", category: "Attendance" },
  { key: "BREAK_REMINDER_MINUTES", value: "5", description: "Warning shown this many minutes before the paid break pool runs out.", category: "Attendance" },
  { key: "CLOCKIN_WINDOW_MINUTES", value: "30", description: "Clock-In button appears this many minutes before shift start.", category: "Attendance" },
  { key: "OVERTIME_MULTIPLIER", value: "1.25", description: "Overtime hourly rate = basic rate × this factor.", category: "Payroll" },
  { key: "ADMIN_PIN", value: "9999", description: "Admin login PIN.", category: "Security" },
  { key: "ANNUAL_LEAVE_ENTITLEMENT", value: "20", description: "Annual leave days accrued per year.", category: "Leave" },
  { key: "SICK_LEAVE_ENTITLEMENT", value: "14", description: "Sick leave days per year.", category: "Leave" },
  { key: "CASUAL_LEAVE_ENTITLEMENT", value: "10", description: "Casual leave days per year.", category: "Leave" },
  { key: "SHEETS_API_URL", value: "", description: "Google Apps Script Web App /exec URL for cloud sync.", category: "Integration" },
  { key: "SHEETS_API_KEY", value: "khan-pharmacy-2026", description: "Shared secret sent with sync requests.", category: "Integration" },
];

export function configValue(config: ConfigEntry[], key: string, fallback = ""): string {
  return config.find((c) => c.key === key)?.value ?? fallback;
}
export function configNumber(config: ConfigEntry[], key: string, fallback: number): number {
  const v = Number(configValue(config, key, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
}

export const TAX_SLABS: TaxSlab[] = [
  { from: 0, to: 350000, rate: 0.0 },
  { from: 350000, to: 450000, rate: 0.05 },
  { from: 450000, to: 750000, rate: 0.1 },
  { from: 750000, to: 1150000, rate: 0.15 },
  { from: 1150000, to: null, rate: 0.2 },
];

/** Master admin credentials (manual fallback). */
export const ADMIN = { USERNAME: "admin", PASSWORD: "9999" };

/** Exactly 2 staff may be flagged as Supervisor/Cashier hybrid role. */
export const SUPERVISOR_MAX = 2;

/** ID_PREFIX + 2-digit serial → KP9820 (internal record id only). */
export const ID_PREFIX = "KP98";
export function idFromSerial(serial: number): string {
  return `${ID_PREFIX}${String(serial).padStart(2, "0")}`;
}

// ============================================================================
// Bangla Motivation Engine — pharmacy / service / patient-care themed.
// ============================================================================

export interface BanglaQuote { text: string; }

export const MOTIVATION_QUOTES: BanglaQuote[] = [
  { text: "Every prescription filled correctly saves a life. Have a great shift!" },
  { text: "A patient's smile is the best prescription we can give." },
  { text: "Accuracy in every dose — someone's life depends on it." },
  { text: "Medicine is not just business; it is the noble work of saving lives." },
  { text: "Treat every customer like a member of your own family." },
  { text: "One correct medicine protects one precious life." },
  { text: "Welcome everyone with a smile — that is the first step of great service." },
  { text: "Small acts of care bring great respect." },
  { text: "Understanding a patient's pain is the mark of a true caregiver." },
  { text: "Our job is not just giving medicine — it is giving hope." },
  { text: "May every recommendation you make today be safe and right." },
  { text: "Great service is the best advertisement a pharmacy can have." },
  { text: "Your honesty and hard work today build tomorrow's trust." },
  { text: "Healthcare excellence begins with you. Make it count!" },
];

export const PRAISE_MESSAGES: string[] = [
  "শাবাশ! ঠিক সময়ে উপস্থিত হয়েছেন।",
  "অসাধারণ! সময়নিষ্ঠতার জন্য ধন্যবাদ।",
  "দুর্দান্ত! আদর্শ নিয়মানুবর্তিতা।",
  "চমৎকার! সময়মতো উপস্থিত থাকার জন্য শুভেচ্ছা।",
];

/** Random item, avoiding the previous one so it never repeats twice in a row. */
export function pickRandom<T>(arr: T[], avoid?: T): T {
  if (arr.length <= 1) return arr[0];
  let pick = arr[Math.floor(Math.random() * arr.length)];
  let guard = 0;
  while (pick === avoid && guard++ < 8) pick = arr[Math.floor(Math.random() * arr.length)];
  return pick;
}
