-- SmartGym · 0001 · Core tables
-- D1 stores necessary business data only: IDs, short text, dates, times, numbers and
-- statuses. No photos, images, files, PDFs, base64, BLOBs or large JSON — ever.
-- Timestamps are UTC 'YYYY-MM-DD HH:MM:SS'; calendar dates are the gym's local 'YYYY-MM-DD'.
-- Money is INTEGER paise (₹1 = 100) so totals never suffer floating-point errors.

CREATE TABLE roles (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE CHECK (name IN ('ADMIN', 'STAFF', 'TRAINER', 'MEMBER')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO roles (id, name) VALUES (1, 'ADMIN'), (2, 'STAFF'), (3, 'TRAINER'), (4, 'MEMBER');

-- Sign-in accounts. Admin and staff sign in with the email / phone stored here. Trainer and
-- member accounts sign in with the contact details of their trainer / member record (no
-- duplicate copies here), or a member with their member ID.
CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT    NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
    email                TEXT    COLLATE NOCASE CHECK (email IS NULL OR length(email) BETWEEN 5 AND 120),
    phone                TEXT    CHECK (phone IS NULL OR length(phone) BETWEEN 7 AND 15),
    password_hash        TEXT    NOT NULL CHECK (length(password_hash) <= 200),
    role_id              INTEGER NOT NULL REFERENCES roles (id),
    status               TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    -- Security state: forced password change, token revocation and sign-in lockout.
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    token_version        INTEGER NOT NULL DEFAULT 1,
    failed_logins        INTEGER NOT NULL DEFAULT 0,
    locked_until         TEXT,
    last_login_at        TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (role_id NOT IN (1, 2) OR email IS NOT NULL OR phone IS NOT NULL),
    CHECK (role_id IN (1, 2) OR (email IS NULL AND phone IS NULL))
);

CREATE TABLE trainers (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER UNIQUE REFERENCES users (id),
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
    phone          TEXT    NOT NULL CHECK (length(phone) BETWEEN 7 AND 15),
    email          TEXT    COLLATE NOCASE CHECK (email IS NULL OR length(email) BETWEEN 5 AND 120),
    specialization TEXT    CHECK (specialization IS NULL OR length(specialization) <= 80),
    joining_date   TEXT    NOT NULL CHECK (length(joining_date) = 10),
    status         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- status: ACTIVE (paid membership covers today) · EXPIRED (membership ended) ·
-- INACTIVE (no membership yet, or left the gym) · SUSPENDED (on hold by the admin).
-- "Expiring" is shown when the current membership ends within 7 days; it is computed.
CREATE TABLE members (
    id                INTEGER PRIMARY KEY,
    member_code       TEXT    NOT NULL UNIQUE CHECK (length(member_code) BETWEEN 4 AND 16),
    user_id           INTEGER UNIQUE REFERENCES users (id),
    name              TEXT    NOT NULL COLLATE NOCASE CHECK (length(name) BETWEEN 2 AND 80),
    phone             TEXT    NOT NULL CHECK (length(phone) BETWEEN 7 AND 15),
    email             TEXT    COLLATE NOCASE CHECK (email IS NULL OR length(email) BETWEEN 5 AND 120),
    gender            TEXT    CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'OTHER')),
    date_of_birth     TEXT    CHECK (date_of_birth IS NULL OR length(date_of_birth) = 10),
    address           TEXT    CHECK (address IS NULL OR length(address) <= 250),
    emergency_contact TEXT    CHECK (emergency_contact IS NULL OR length(emergency_contact) <= 80),
    joining_date      TEXT    NOT NULL CHECK (length(joining_date) = 10),
    trainer_id        INTEGER REFERENCES trainers (id),
    status            TEXT    NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED')),
    -- Opaque random attendance token encoded in the member's QR. It reveals nothing about
    -- the member and is replaced when the member reports a lost or shared QR.
    qr_token          TEXT    NOT NULL UNIQUE CHECK (length(qr_token) BETWEEN 16 AND 40),
    created_by        INTEGER REFERENCES users (id),
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE membership_plans (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL UNIQUE COLLATE NOCASE CHECK (length(name) BETWEEN 2 AND 60),
    duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 1830),
    price         INTEGER NOT NULL CHECK (price > 0),
    description   TEXT    CHECK (description IS NULL OR length(description) <= 200),
    status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A membership row exists only after its payment is confirmed (PAID): dates are always
-- calculated by the backend at activation. `amount` is what was actually paid.
CREATE TABLE memberships (
    id         INTEGER PRIMARY KEY,
    member_id  INTEGER NOT NULL REFERENCES members (id),
    plan_id    INTEGER NOT NULL REFERENCES membership_plans (id),
    start_date TEXT    NOT NULL CHECK (length(start_date) = 10),
    end_date   TEXT    NOT NULL CHECK (length(end_date) = 10),
    amount     INTEGER NOT NULL CHECK (amount >= 0),
    status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRING', 'EXPIRED', 'CANCELLED')),
    created_by INTEGER REFERENCES users (id),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (end_date >= start_date)
);

-- Admin-editable gym settings (gym profile, UPI ID, reminder and retention rules).
-- Only overrides are stored; defaults live in code. Never holds secrets.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY CHECK (length(key) <= 40),
    value      TEXT NOT NULL CHECK (length(value) <= 300),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
