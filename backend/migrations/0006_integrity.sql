-- SmartGym · 0006 · Business rules enforced by the database itself
-- SQLite cannot ALTER TABLE ... ADD CONSTRAINT, so rules are unique (partial) indexes and
-- small guard triggers. Guards fire only for the rows being written: no extra read cost.

-- One attendance row per member per day (repeat scans never duplicate).
CREATE UNIQUE INDEX ux_attendance_member_day ON attendance (member_id, attendance_date);

-- A UTR / bank reference can back only one live payment. A rejected or failed attempt does
-- not block a corrected resubmission.
CREATE UNIQUE INDEX ux_payments_reference ON payments (transaction_reference)
    WHERE transaction_reference IS NOT NULL
      AND payment_method IN ('UPI', 'BANK_TRANSFER')
      AND status IN ('PENDING', 'PAID', 'REFUNDED');

-- Recording a payment is safe against double clicks and network retries.
CREATE UNIQUE INDEX ux_payments_idempotency ON payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- At most one payment awaiting verification per member.
CREATE UNIQUE INDEX ux_payments_one_pending ON payments (member_id) WHERE status = 'PENDING';

-- A payment can only point at a membership of the same member.
CREATE TRIGGER trg_payments_membership_owner_insert
BEFORE INSERT ON payments
WHEN NEW.membership_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM memberships WHERE id = NEW.membership_id AND member_id = NEW.member_id)
BEGIN
    SELECT RAISE(ABORT, 'payment membership belongs to a different member');
END;

CREATE TRIGGER trg_payments_membership_owner_update
BEFORE UPDATE OF membership_id ON payments
WHEN NEW.membership_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM memberships WHERE id = NEW.membership_id AND member_id = NEW.member_id)
BEGIN
    SELECT RAISE(ABORT, 'payment membership belongs to a different member');
END;

-- Confirmed money is append-only.
CREATE TRIGGER trg_payments_confirmed_immutable
BEFORE UPDATE OF payment_number, member_id, plan_id, amount, payment_method, transaction_reference, payment_date
ON payments
WHEN OLD.status IN ('PAID', 'REFUNDED')
BEGIN
    SELECT RAISE(ABORT, 'confirmed payments are immutable');
END;

-- Status only moves forward: PENDING -> PAID | REJECTED | FAILED, and PAID -> REFUNDED.
CREATE TRIGGER trg_payments_status_flow
BEFORE UPDATE OF status ON payments
WHEN NEW.status != OLD.status
 AND NOT ((OLD.status = 'PENDING' AND NEW.status IN ('PAID', 'REJECTED', 'FAILED'))
       OR (OLD.status = 'PAID' AND NEW.status = 'REFUNDED'))
BEGIN
    SELECT RAISE(ABORT, 'invalid payment status change');
END;

-- A refund can never exceed the payment, and only a confirmed payment can be refunded.
CREATE TRIGGER trg_refunds_valid
BEFORE INSERT ON refunds
WHEN NOT EXISTS (SELECT 1 FROM payments WHERE id = NEW.payment_id AND status IN ('PAID', 'REFUNDED') AND amount >= NEW.amount)
BEGIN
    SELECT RAISE(ABORT, 'refund must match a confirmed payment and cannot exceed it');
END;

-- Financial and membership history can only be removed by a backed-up, verified,
-- admin-confirmed archive run covering the row's period ("ARCHIVING" backup).
CREATE TRIGGER trg_payments_archive_only
BEFORE DELETE ON payments
WHEN NOT EXISTS (
    SELECT 1 FROM backups
    WHERE kind = 'BACKUP' AND status = 'ARCHIVING' AND instr(',' || tables || ',', ',payments,') > 0
      AND OLD.payment_date BETWEEN period_from AND period_to)
BEGIN
    SELECT RAISE(ABORT, 'payments can only be removed by a verified archive');
END;

CREATE TRIGGER trg_refunds_archive_only
BEFORE DELETE ON refunds
WHEN NOT EXISTS (
    SELECT 1 FROM backups b JOIN payments p ON p.id = OLD.payment_id
    WHERE b.kind = 'BACKUP' AND b.status = 'ARCHIVING' AND instr(',' || b.tables || ',', ',payments,') > 0
      AND p.payment_date BETWEEN b.period_from AND b.period_to)
BEGIN
    SELECT RAISE(ABORT, 'refunds can only be removed by a verified archive');
END;

CREATE TRIGGER trg_memberships_archive_only
BEFORE DELETE ON memberships
WHEN NOT EXISTS (
    SELECT 1 FROM backups
    WHERE kind = 'BACKUP' AND status = 'ARCHIVING' AND instr(',' || tables || ',', ',memberships,') > 0
      AND OLD.end_date BETWEEN period_from AND period_to)
BEGIN
    SELECT RAISE(ABORT, 'membership history can only be removed by a verified archive');
END;

-- Members are never deleted (deactivate them instead); their history depends on them.
CREATE TRIGGER trg_members_no_delete
BEFORE DELETE ON members
BEGIN
    SELECT RAISE(ABORT, 'members cannot be deleted');
END;
