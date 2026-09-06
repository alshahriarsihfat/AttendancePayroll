import { createSeedData } from "../src/lib/seed";
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
  const { staff } = createSeedData();

  for (const employee of staff) {
    await prisma.staff.upsert({
      where: { employeeId: employee.employeeId },
      create: {
        employeeId: employee.employeeId,
        username: employee.username,
        password: employee.password,
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
        password: employee.password,
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

  console.log(`Seeded ${staff.length} staff records.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });