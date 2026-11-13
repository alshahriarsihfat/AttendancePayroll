-- AlterTable
ALTER TABLE "AdvanceLog" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "paymentAllocationId" TEXT;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "workingDaysPerWeek" INTEGER;

-- AlterTable
ALTER TABLE "TimeSession" ADD COLUMN     "deductionSnapshot" DOUBLE PRECISION,
ADD COLUMN     "grossEarningSnapshot" DOUBLE PRECISION,
ADD COLUMN     "monthlyCalendarDaysSnapshot" INTEGER,
ADD COLUMN     "monthlyScheduledHoursSnapshot" DOUBLE PRECISION,
ADD COLUMN     "netEarningSnapshot" DOUBLE PRECISION,
ADD COLUMN     "overtimeEarningSnapshot" DOUBLE PRECISION,
ADD COLUMN     "payableHoursSnapshot" DOUBLE PRECISION,
ADD COLUMN     "payableMinutesSnapshot" INTEGER,
ADD COLUMN     "payrollApplicableSalary" DOUBLE PRECISION,
ADD COLUMN     "payrollCalculationStatus" TEXT,
ADD COLUMN     "payrollIncompleteReason" TEXT,
ADD COLUMN     "payrollPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "payrollPeriodKey" TEXT,
ADD COLUMN     "payrollPeriodKind" TEXT,
ADD COLUMN     "payrollPeriodStart" TIMESTAMP(3),
ADD COLUMN     "payrollSalaryType" TEXT,
ADD COLUMN     "payrollSnapshotAt" TIMESTAMP(3),
ADD COLUMN     "payrollSnapshotBy" TEXT,
ADD COLUMN     "scheduledDutyHoursSnapshot" DOUBLE PRECISION,
ADD COLUMN     "weeklyScheduledHoursSnapshot" DOUBLE PRECISION,
ADD COLUMN     "weeklyWorkingDaysSnapshot" INTEGER;

-- CreateTable
CREATE TABLE "PayrollEarning" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "salaryType" TEXT NOT NULL,
    "applicableSalary" DOUBLE PRECISION,
    "dailyDutyHours" DOUBLE PRECISION,
    "workingDaysPerWeek" INTEGER,
    "weeklyScheduledHours" DOUBLE PRECISION,
    "monthlyCalendarDays" INTEGER,
    "monthlyScheduledHours" DOUBLE PRECISION,
    "periodKind" TEXT,
    "periodKey" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "hourlyRate" DOUBLE PRECISION,
    "payableHours" DOUBLE PRECISION,
    "payableMinutes" INTEGER,
    "grossEarning" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overtimeEarning" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deductionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netEarning" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculationStatus" TEXT,
    "incompleteReason" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "calculatedBy" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'SESSION',
    "sourceRef" TEXT,
    "accrualIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "payrollEarningId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "allocationType" TEXT NOT NULL DEFAULT 'SETTLEMENT',
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedBy" TEXT,
    "idempotencyKey" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEarning_sessionId_key" ON "PayrollEarning"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEarning_accrualIdempotencyKey_key" ON "PayrollEarning"("accrualIdempotencyKey");

-- CreateIndex
CREATE INDEX "PayrollEarning_staffId_periodStart_idx" ON "PayrollEarning"("staffId", "periodStart");

-- CreateIndex
CREATE INDEX "PayrollEarning_periodKey_idx" ON "PayrollEarning"("periodKey");

-- CreateIndex
CREATE INDEX "PayrollEarning_calculationStatus_idx" ON "PayrollEarning"("calculationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_idempotencyKey_key" ON "PaymentAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAllocation_staffId_allocatedAt_idx" ON "PaymentAllocation"("staffId", "allocatedAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_payrollEarningId_idx" ON "PaymentAllocation"("payrollEarningId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_paymentId_payrollEarningId_key" ON "PaymentAllocation"("paymentId", "payrollEarningId");

-- CreateIndex
CREATE INDEX "AdvanceLog_paymentAllocationId_idx" ON "AdvanceLog"("paymentAllocationId");

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceLog_idempotencyKey_key" ON "AdvanceLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TimeSession_payrollPeriodKey_idx" ON "TimeSession"("payrollPeriodKey");

-- CreateIndex
CREATE INDEX "TimeSession_payrollCalculationStatus_idx" ON "TimeSession"("payrollCalculationStatus");

-- AddForeignKey
ALTER TABLE "AdvanceLog" ADD CONSTRAINT "AdvanceLog_paymentAllocationId_fkey" FOREIGN KEY ("paymentAllocationId") REFERENCES "PaymentAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEarning" ADD CONSTRAINT "PayrollEarning_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TimeSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollEarning" ADD CONSTRAINT "PayrollEarning_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_payrollEarningId_fkey" FOREIGN KEY ("payrollEarningId") REFERENCES "PayrollEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;

