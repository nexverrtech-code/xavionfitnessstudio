-- SmartGym · 0007 · Several visits a day
-- A member may check in and out more than once a day (morning, afternoon, night). Every visit
-- is its own row; member stats, the dashboard and reports still count days present once per day.
--
-- Deploy the Worker first, then apply this migration: the previous Worker's "one row per day"
-- insert depends on the index dropped here, while the new Worker works with either schema
-- (until this runs, a second visit on the same day is refused with a clear message).

DROP INDEX IF EXISTS ux_attendance_member_day;

-- One row per visit (a member cannot start two visits in the same second). It is also the
-- per-member lookup: the latest visit, visits today and history by date read only a few rows.
CREATE UNIQUE INDEX ux_attendance_member_visit ON attendance (member_id, attendance_date, check_in);
