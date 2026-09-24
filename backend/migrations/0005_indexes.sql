-- SmartGym · 0005 · Indexes
-- Indexes cost storage and extra D1 row writes, so each one backs a specific screen or job.
-- UNIQUE columns (members.member_code, members.user_id, members.qr_token, trainers.user_id,
-- payments.payment_number, refunds.payment_id, membership_plans.name) are already indexed.

-- Sign-in for admin / staff accounts.
CREATE UNIQUE INDEX ux_users_email ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_phone ON users (phone) WHERE phone IS NOT NULL;

-- Member search (name / phone / email prefix), status filters and "my members" for trainers.
CREATE INDEX idx_members_name    ON members (name);
CREATE INDEX idx_members_phone   ON members (phone);
CREATE INDEX idx_members_email   ON members (email) WHERE email IS NOT NULL;
CREATE INDEX idx_members_status  ON members (status);
CREATE INDEX idx_members_trainer ON members (trainer_id) WHERE trainer_id IS NOT NULL;

-- A member's memberships / current expiry, and the daily expiry job (status + end_date).
CREATE INDEX idx_memberships_member_end ON memberships (member_id, end_date);
CREATE INDEX idx_memberships_status_end ON memberships (status, end_date);

-- Payment history per member, revenue and the pending-verification queue, date filters.
CREATE INDEX idx_payments_member_date ON payments (member_id, payment_date);
CREATE INDEX idx_payments_status_date ON payments (status, payment_date);
CREATE INDEX idx_payments_date        ON payments (payment_date);
CREATE INDEX idx_payments_membership  ON payments (membership_id) WHERE membership_id IS NOT NULL;

-- Daily attendance log and trends. Per-member history uses the UNIQUE index in 0006.
CREATE INDEX idx_attendance_date ON attendance (attendance_date);

CREATE INDEX idx_workout_plans_member   ON workout_plans (member_id, status);
CREATE INDEX idx_workout_plans_trainer  ON workout_plans (trainer_id) WHERE trainer_id IS NOT NULL;
CREATE INDEX idx_workout_exercises_plan ON workout_exercises (workout_plan_id, position);

CREATE INDEX idx_measurements_member ON body_measurements (member_id, recorded_at);

-- Inbox + reminder de-duplication; admin log and retention cleanup.
CREATE INDEX idx_notifications_user    ON notifications (user_id, created_at);
CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE INDEX idx_expenses_date ON expenses (expense_date);
