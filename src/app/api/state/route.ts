import { Prisma } from "@prisma/client";
import { DEFAULT_CONFIG } from "@/lib/config";
import { dbErrorResponse } from "@/lib/api-error";
import { dateKeyInZone } from "@/lib/dates";
import { prisma } from "@/server/db";
import { COOKIE_NAME, decodeSession } from "@/lib/auth-session";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const STATE_KEY = "default";

type StatePayload = {
  data?: unknown;
  session?: unknown;
};

export async function GET() {
  const session = decodeSession((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  try {
    const state = await prisma.appState.findUnique({ where: { key: STATE_KEY } });
    const staffRows = await prisma.staff.findMany({ orderBy: { employeeId: "asc" } });
    let configRows = await prisma.config.findMany({ orderBy: { key: "asc" } });
    if (configRows.length === 0) {
      await prisma.config.createMany({ data: DEFAULT_CONFIG, skipDuplicates: true });
      configRows = await prisma.config.findMany({ orderBy: { key: "asc" } });
    }
    const snapshot = state?.data as { staff?: unknown } | null;
    const leaveRows = await prisma.leaveRequest.findMany();
    const sessionRows = await prisma.timeSession.findMany();
    const paymentRows = await prisma.payment.findMany();
    const overtimeRows = await prisma.overtimeLog.findMany();
    const balanceRows = await prisma.leaveBalance.findMany();
    const approvalRows = await prisma.approvalRequest.findMany();
    const auditRows = await prisma.auditLog.findMany();

    // =========================================================================
    // Role-based data filtering (Vuln 3 fix)
    //   STAFF       → only their own records; financial fields zeroed.
    //   SUPERVISOR  → full operational dataset (needs rates to verify pay).
    //   ADMIN       → full dataset.
    // =========================================================================
    const isStaff = session.role === "STAFF";
    const myId = session.staffId ?? "";
    const visibleStaff = isStaff ? staffRows.filter((s) => s.employeeId === myId) : staffRows;
    const visibleSessions = isStaff ? sessionRows.filter((s) => s.staffId === myId) : sessionRows;
    const visiblePayments = isStaff ? paymentRows.filter((p) => p.staffId === myId) : paymentRows;
    const visibleOvertime = isStaff ? overtimeRows.filter((o) => o.staffId === myId) : overtimeRows;
    const visibleLeave = isStaff ? leaveRows.filter((r) => r.staffId === myId) : leaveRows;
    const visibleBalances = isStaff ? balanceRows.filter((b) => b.staffId === myId) : balanceRows;
    const visibleApprovals = isStaff ? approvalRows.filter((a) => a.staffId === myId) : approvalRows;
    const visibleAudit = isStaff ? auditRows.filter((l) => l.entityId === myId) : auditRows;

    const data = snapshot && visibleStaff.length > 0
      ? {
          ...snapshot,
          staff: visibleStaff.map((staff) => ({
            recordId: staff.id,
            employeeId: staff.employeeId,
            username: staff.username,
            password: "",
            fullName: staff.fullName,
            email: staff.email ?? "",
            phone: staff.phone ?? "",
            department: staff.department,
            jobTitle: staff.jobTitle,
            section: staff.section,
            counter: staff.counter,
            joinDate: dateKeyInZone(staff.joinDate),
            endDate: staff.endDate ? dateKeyInZone(staff.endDate) : null,
            role: staff.role === "SUPERVISOR" ? "SUPERVISOR" : "STAFF",
            salaryType: staff.salaryType.charAt(0) + staff.salaryType.slice(1).toLowerCase(),
            baseSalary: isStaff ? 0 : staff.baseSalary,
            dailyRate: isStaff ? 0 : staff.dailyRate,
            hourlyRate: isStaff ? 0 : staff.hourlyRate,
            shiftStart: staff.shiftStart,
            shiftEnd: staff.shiftEnd,
            mealBreakMin: staff.mealBreakMin,
            restMin: staff.restMin,
            shiftId: "SH-FULL",
            photoUrl: staff.photoUrl ?? "",
            status: staff.status === "ON_LEAVE" ? "On-leave" : staff.status === "TERMINATED" ? "Terminated" : "Active",
            isActive: staff.isActive,
            arrears: isStaff ? 0 : staff.arrears,
            advance: isStaff ? 0 : staff.advance,
          })),
          leaveRequests: visibleLeave.map((r) => ({
            recordId: r.id,
            staffId: r.staffId,
            leaveType: r.leaveType,
            fromDate: dateKeyInZone(r.fromDate),
            toDate: dateKeyInZone(r.toDate),
            days: r.days,
            reason: r.reason ?? undefined,
            status: r.status,
            approvedBy: r.approvedBy ?? null,
            approvedAt: r.approvedAt?.toISOString() ?? null,
            comment: r.comment ?? undefined,
          })),
          sessions: visibleSessions.map((s) => ({
            id: s.id,
            staffId: s.staffId,
            // s.date is stored as Dhaka midnight (UTC+6); `toISOString().slice(0,10)`
            // would return the UTC date — the previous calendar day between
            // 18:00–24:00 UTC. Resolve against Asia/Dhaka instead.
            date: dateKeyInZone(s.date),
            timeIn: s.timeIn.toISOString(),
            timeOut: s.timeOut?.toISOString() ?? null,
            breaks: s.breaks as Prisma.InputJsonValue,
            goOuts: s.goOuts as Prisma.InputJsonValue,
            extraTime: s.extraTime as Prisma.InputJsonValue,
            completed: s.completed,
            autoClockedOut: s.autoClockedOut,
          })),
          payments: visiblePayments.map((p) => ({
            id: p.id,
            staffId: p.staffId,
            sessionId: p.sessionId,
            date: dateKeyInZone(p.date),
            paidAt: p.paidAt.toISOString(),
            periodLabel: p.periodLabel,
            dutyHours: p.dutyHours,
            workedMin: p.workedMin,
            breakMin: p.breakMin,
            overBreakMin: p.overBreakMin,
            overtimeMin: p.overtimeMin,
            hourlyRate: p.hourlyRate,
            grossPay: p.grossPay,
            overtimePay: p.overtimePay,
            overBreakDeduction: p.overBreakDeduction,
            advanceAdjusted: p.advanceAdjusted,
            netPay: p.netPay,
            status: p.status,
            paidBy: p.paidBy,
          })),
          overtimeLogs: visibleOvertime.map((o) => ({
            id: o.id,
            staffId: o.staffId,
            date: dateKeyInZone(o.date),
            overtimeMin: o.overtimeMin,
            hourlyRate: o.hourlyRate,
            amount: o.amount,
          })),
          leaveBalances: visibleBalances.map((b) => ({
            staffId: b.staffId,
            leaveType: b.leaveType,
            entitledDays: b.entitledDays,
            usedDays: b.usedDays,
            year: b.year,
          })),
          approvalRequests: visibleApprovals.map((a) => ({
            id: a.id,
            staffId: a.staffId,
            sessionId: a.sessionId,
            type: a.type,
            deltaMin: a.deltaMin,
            date: dateKeyInZone(a.date),
            status: a.status,
            managerNote: a.managerNote ?? undefined,
            resolvedBy: a.resolvedBy ?? null,
            resolvedAt: a.resolvedAt?.toISOString() ?? null,
          })),
          auditLog: visibleAudit.map((l) => ({
            logId: l.id,
            timestamp: l.timestamp.toISOString(),
            action: l.action,
            entityType: l.entityType,
            entityId: l.entityId,
            actorName: l.actorName,
            actorRole: l.actorRole as "ADMIN" | "SUPERVISOR" | "STAFF",
            summary: l.summary,
            managedBy: l.managedBy ?? null,
          })),
          config: configRows,
        }
      : state?.data ? { ...(state.data as object), config: configRows } : { config: configRows };
    return Response.json({ data });
  } catch (error) {
    return dbErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  if (!decodeSession((await cookies()).get(COOKIE_NAME)?.value)) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  const payload = await request.json() as StatePayload;
  if (!payload.data || typeof payload.data !== "object") {
    return Response.json({ error: "Invalid state payload" }, { status: 400 });
  }

  try {
    const state = await prisma.appState.upsert({
      where: { key: STATE_KEY },
      create: {
        key: STATE_KEY,
        data: payload.data as Prisma.InputJsonValue,
        session: Prisma.JsonNull,
      },
      update: {
        data: payload.data as Prisma.InputJsonValue,
        session: Prisma.JsonNull,
      },
    });

    return Response.json({ ok: true, updatedAt: state.updatedAt });
  } catch (error) {
    return dbErrorResponse(error);
  }
}