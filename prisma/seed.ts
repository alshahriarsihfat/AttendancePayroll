import "dotenv/config";
import { createSeedData } from "../src/lib/seed";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/server/db";

const roleMap = {
  STAFF: "STAFF",
  SUPERVISOR: "SUPERVISOR",
} as const;

const salaryTypeMap = {
  Daily: "DAILY",
  Weekly: "WEEKLY",
  Monthly: "MONTHLY",
  Hourly: "HOURLY",
} as const;

const statusMap = {
  Active: "ACTIVE",
  "On-leave": "ON_LEAVE",
  Terminated: "TERMINATED",
} as const;

async function main() {
  const { staff, leaveRequests, leaveBalances } = createSeedData();

  for (const employee of staff) {
    const hashedPassword = hashPassword(employee.password);
    await prisma.staff.upsert({
      where: { employeeId: employee.employeeId },
      create: {
        employeeId: employee.employeeId,
        username: employee.username,
        password: hashedPassword,
        fullName: employee.fullName,
        email: employee.email || null,
        phone: employee.phone || null,
        department: employee.department,
        jobTitle: employee.jobTitle,
        section: employee.section,
        counter: employee.counter,
        role: roleMap[employee.role],
        salaryType: salaryTypeMap[employee.salaryType],
        baseSalary: employee.baseSalary,
        dailyRate: employee.dailyRate,
        hourlyRate: employee.hourlyRate,
        shiftStart: employee.shiftStart,
        shiftEnd: employee.shiftEnd,
        mealBreakMin: employee.mealBreakMin,
        restMin: employee.restMin,
        photoUrl: employee.photoUrl || null,
        status: statusMap[employee.status],
        isActive: employee.isActive,
        arrears: employee.arrears,
        advance: employee.advance,
        joinDate: new Date(employee.joinDate),
        endDate: employee.endDate ? new Date(employee.endDate) : null,
      },
      update: {
        username: employee.username,
        password: hashedPassword,
        fullName: employee.fullName,
        email: employee.email || null,
        phone: employee.phone || null,
        department: employee.department,
        jobTitle: employee.jobTitle,
        section: employee.section,
        counter: employee.counter,
        role: roleMap[employee.role],
        salaryType: salaryTypeMap[employee.salaryType],
        baseSalary: employee.baseSalary,
        dailyRate: employee.dailyRate,
        hourlyRate: employee.hourlyRate,
        shiftStart: employee.shiftStart,
        shiftEnd: employee.shiftEnd,
        mealBreakMin: employee.mealBreakMin,
        restMin: employee.restMin,
        photoUrl: employee.photoUrl || null,
        status: statusMap[employee.status],
        isActive: employee.isActive,
        arrears: employee.arrears,
        advance: employee.advance,
        joinDate: new Date(employee.joinDate),
        endDate: employee.endDate ? new Date(employee.endDate) : null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Leave requests + balances
  // The GET /api/state handler now serves leave rows straight from the DB
  // (they overlay the old client-side snapshot). Without seeding them here the
  // Admin/Supervisor approval queues would be EMPTY on a fresh deployment even
  // though the app's sample data shows pending leave. Seed the same records the
  // client demo generates so the queues populate on first login.
  // ---------------------------------------------------------------------------
  for (const req of leaveRequests) {
    await prisma.leaveRequest.upsert({
      where: { id: req.recordId },
      create: {
        id: req.recordId,
        staffId: req.staffId,
        leaveType: req.leaveType,
        // Dhaka midnight — identical calendar day in UTC and +06:00 servers.
        fromDate: new Date(`${req.fromDate}T00:00:00+06:00`),
        toDate: new Date(`${req.toDate}T00:00:00+06:00`),
        days: req.days,
        reason: req.reason || null,
        status: req.status,
        approvedBy: req.approvedBy ?? null,
        approvedAt: req.approvedAt ? new Date(req.approvedAt) : null,
        comment: req.comment ?? null,
      },
      update: {},
    });
  }

  for (const bal of leaveBalances) {
    await prisma.leaveBalance.upsert({
      where: {
        staffId_leaveType_year: {
          staffId: bal.staffId,
          leaveType: bal.leaveType,
          year: bal.year,
        },
      },
      create: {
        staffId: bal.staffId,
        leaveType: bal.leaveType,
        entitledDays: bal.entitledDays,
        usedDays: bal.usedDays,
        year: bal.year,
      },
      update: {},
    });
  }

  console.log(`Seeded ${staff.length} staff, ${leaveRequests.length} leave requests, ${leaveBalances.length} leave balances.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });