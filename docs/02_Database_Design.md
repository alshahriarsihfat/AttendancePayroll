# Database Design (KPSMS)

## Core entities
- Staff, Department, Shift, TimeSession, Payment, LeaveRequest, LeaveBalance, Holiday, ApprovalRequest, AuditLog, AppState, Config.

## Key principles
- Employee profile separate from shift assignment, department assignment, responsibilities.
- Historical snapshots in TimeSession for shift/salary.
- Departments deactivated, not deleted.
- No schema changes in this documentation task.
