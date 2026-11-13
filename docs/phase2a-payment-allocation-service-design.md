# Payment Allocation Phase 2A — Core Service Design (pre-implementation)

## Proposed module
`src/lib/payment-allocation-service.ts` (server-side, Prisma/tx-aware; no schema/API/UI changes)

## Inputs (proposed)
- `allocate(tx, { staffId, amount, actor, idempotencyKey?, paymentId? | payment?: { paidBy, paidAt?, periodLabel?, note? }, advanceAdjustment?: 0 (disabled default), dryRun? false })`
  - `amount`: positive cash amount to allocate (BDT) — server-authoritative validation.
  - `paymentId`: allocate from an existing `Payment` (no new Payment row created).
  - `payment`: create a NEW non-legacy allocation payment (`sessionId=null`, `batchId` optional/generated, legacy wage snapshot fields zeroed/defaulted, `netPay=amount`, `advanceAdjusted=0` unless explicit adjustment safely implemented; explicit adjustment deferred in this phase so defaults to 0). **Never sets `sessionId`** to avoid breaking legacy `@unique Payment.sessionId` settlement semantics.
  - `idempotencyKey`: required when caller needs duplicate-submission protection; stored on created `PaymentAllocation.idempotencyKey` rows (unique). For multi-allocation in one request, derive stable per-allocation keys (`${idempotencyKey}:${payrollEarningId}`) or require single key mapping; service rejects/returns existing result on unique conflict.

## Outputs (proposed)
- `{ ok, paymentId, staffId, allocatedTotal, allocations:[{id,payrollEarningId,amount}], outstandingAfter, skippedDuplicate?:boolean }`

## Read helpers
- `getOutstandingEarnings(tx, staffId)` ? CALCULATED earnings only; `netEarning - sum(valid allocations)`; ordered oldest-unpaid-first, tie-break `id asc`. Excludes INCOMPLETE. Handles legacy settlements by counting existing `Payment` rows with `sessionId == earning.sessionId` as fully settled for that earning (prevents double counting) — such earnings excluded from allocatable outstanding unless/until explicit legacy-compat policy says otherwise (reported).

## Transaction boundary (single `$transaction` / caller-provided tx)
1. Re-read staff (ownership/existence), lock-relevant authoritative state.
2. Re-read/compute outstanding for `staffId` inside tx (no client balances).
3. Validate: amount>0, staff owns target context, amount <= total outstanding, no INCOMPLETE targets.
4. Create Payment (if requested) — non-legacy only in this service.
5. Create `PaymentAllocation` rows (oldest-first, partial/full) with deterministic allocation amounts; `@@unique([paymentId,payrollEarningId])` + optional `idempotencyKey` protect duplicates.
6. Advance adjustment: **disabled by default / deferred** (legacy `POST_payment` auto-advances proportionally; explicit adjustment here could conflict). If `advanceAdjustment>0` passed, reject with explicit error in Phase 2A.
7. Create `AuditLog` (append-only) summarizing payment/allocation.
8. No partial commits: any failure throws ? tx rollback.

## Legacy compatibility / conflicts
- Existing `POST /api/payments` (`api-routes.POST_payment`) creates **one Payment row per session** with `sessionId` and auto-advances; receipt/batch semantics depend on it. **Conflict:** a "single new Payment covering multiple earnings" cannot reuse legacy session-bound Payment rows safely without changing behavior. Phase 2A service therefore: (a) calculates outstanding while treating legacy `Payment.sessionId` settlements as settled; (b) can allocate against existing payments by `paymentId` with validation; (c) can create **non-legacy** allocation payments (`sessionId=null`) only — integration into legacy UI/POST_payment deferred. Duplicate-payment submission protection for *new Payment creation* is limited by schema (Payment has no idempotencyKey); service uses allocation idempotency keys + tx revalidation and reports limitation.

## Concurrency/idempotency
- Unique constraints: `Payment.sessionId` (legacy), `PaymentAllocation(paymentId,payrollEarningId)`, `PaymentAllocation.idempotencyKey`, `AdvanceLog.idempotencyKey`.
- Re-read outstanding/earnings inside tx; P2002 handled as idempotent/duplicate where safe.
- No silent retry of partially committed financial operations.
