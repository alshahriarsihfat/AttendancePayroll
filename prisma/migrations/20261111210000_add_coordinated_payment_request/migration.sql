-- CreateTable
CREATE TABLE "CoordinatedPaymentRequest" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoordinatedPaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoordinatedPaymentRequest_idempotencyKey_key" ON "CoordinatedPaymentRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CoordinatedPaymentRequest_staffId_createdAt_idx" ON "CoordinatedPaymentRequest"("staffId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoordinatedPaymentRequest" ADD CONSTRAINT "CoordinatedPaymentRequest_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;
