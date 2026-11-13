-- CreateTable
CREATE TABLE "AdvanceAdjustment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "advanceLogId" TEXT NOT NULL,
    "payrollEarningId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "adjustedBy" TEXT NOT NULL,
    "adjustedByRole" TEXT,
    "adjustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workDate" TEXT,
    "requestFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdvanceAdjustment_idempotencyKey_key" ON "AdvanceAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AdvanceAdjustment_staffId_adjustedAt_idx" ON "AdvanceAdjustment"("staffId", "adjustedAt");

-- CreateIndex
CREATE INDEX "AdvanceAdjustment_staffId_advanceLogId_idx" ON "AdvanceAdjustment"("staffId", "advanceLogId");

-- CreateIndex
CREATE INDEX "AdvanceAdjustment_staffId_payrollEarningId_idx" ON "AdvanceAdjustment"("staffId", "payrollEarningId");

-- CreateIndex
CREATE INDEX "AdvanceAdjustment_payrollEarningId_idx" ON "AdvanceAdjustment"("payrollEarningId");

-- CreateIndex
CREATE INDEX "AdvanceAdjustment_advanceLogId_idx" ON "AdvanceAdjustment"("advanceLogId");

-- AddForeignKey
ALTER TABLE "AdvanceAdjustment" ADD CONSTRAINT "AdvanceAdjustment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceAdjustment" ADD CONSTRAINT "AdvanceAdjustment_advanceLogId_fkey" FOREIGN KEY ("advanceLogId") REFERENCES "AdvanceLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvanceAdjustment" ADD CONSTRAINT "AdvanceAdjustment_payrollEarningId_fkey" FOREIGN KEY ("payrollEarningId") REFERENCES "PayrollEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
