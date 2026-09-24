-- SmartGym · 0003 · Attendance, workouts, progress, expenses and in-app notifications

-- One row per member per gym day (duplicate scans never add rows). Member details are
-- never copied here — only member_id.
CREATE TABLE attendance (
    id              INTEGER PRIMARY KEY,
    member_id       INTEGER NOT NULL REFERENCES members (id),
    attendance_date TEXT    NOT NULL CHECK (length(attendance_date) = 10),
    check_in        TEXT    NOT NULL,
    check_out       TEXT,
    method          TEXT    NOT NULL DEFAULT 'QR' CHECK (method IN ('QR', 'MANUAL')),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (check_out IS NULL OR check_out >= check_in)
);

-- Text only: no exercise images, videos or media URLs.
CREATE TABLE workout_plans (
    id         INTEGER PRIMARY KEY,
    member_id  INTEGER NOT NULL REFERENCES members (id),
    trainer_id INTEGER REFERENCES trainers (id),
    title      TEXT    NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
    day_label  TEXT    CHECK (day_label IS NULL OR length(day_label) <= 30),
    notes      TEXT    CHECK (notes IS NULL OR length(notes) <= 250),
    status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_by INTEGER REFERENCES users (id),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE workout_exercises (
    id              INTEGER PRIMARY KEY,
    workout_plan_id INTEGER NOT NULL REFERENCES workout_plans (id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 99),
    exercise_name   TEXT    NOT NULL CHECK (length(exercise_name) BETWEEN 2 AND 80),
    sets            INTEGER CHECK (sets IS NULL OR sets BETWEEN 1 AND 50),
    reps            TEXT    CHECK (reps IS NULL OR length(reps) <= 16),
    weight          REAL    CHECK (weight IS NULL OR weight BETWEEN 0 AND 1000),
    rest_seconds    INTEGER CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 1800),
    notes           TEXT    CHECK (notes IS NULL OR length(notes) <= 120)
);

-- weight kg · height cm · body_fat % · chest / waist / arm / thigh cm. All optional, but
-- a measurement must contain at least one value.
CREATE TABLE body_measurements (
    id          INTEGER PRIMARY KEY,
    member_id   INTEGER NOT NULL REFERENCES members (id),
    weight      REAL    CHECK (weight IS NULL OR weight BETWEEN 10 AND 400),
    height      REAL    CHECK (height IS NULL OR height BETWEEN 50 AND 260),
    body_fat    REAL    CHECK (body_fat IS NULL OR body_fat BETWEEN 1 AND 75),
    chest       REAL    CHECK (chest IS NULL OR chest BETWEEN 30 AND 250),
    waist       REAL    CHECK (waist IS NULL OR waist BETWEEN 30 AND 250),
    arm         REAL    CHECK (arm IS NULL OR arm BETWEEN 10 AND 100),
    thigh       REAL    CHECK (thigh IS NULL OR thigh BETWEEN 20 AND 150),
    recorded_at TEXT    NOT NULL DEFAULT (datetime('now')),
    created_by  INTEGER REFERENCES users (id),
    CHECK (COALESCE(weight, height, body_fat, chest, waist, arm, thigh) IS NOT NULL)
);

CREATE TABLE expenses (
    id           INTEGER PRIMARY KEY,
    category     TEXT    NOT NULL CHECK (category IN
                         ('RENT', 'ELECTRICITY', 'SALARY', 'EQUIPMENT', 'MAINTENANCE', 'MARKETING', 'OTHER')),
    amount       INTEGER NOT NULL CHECK (amount > 0),
    description  TEXT    CHECK (description IS NULL OR length(description) <= 200),
    expense_date TEXT    NOT NULL CHECK (length(expense_date) = 10),
    created_by   INTEGER REFERENCES users (id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- In-app notifications only (no email / SMS / WhatsApp providers in Version 1).
CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id),
    type       TEXT    NOT NULL CHECK (type IN (
                   'MEMBERSHIP_ACTIVATED', 'MEMBERSHIP_RENEWED', 'PAYMENT_RECEIVED', 'PAYMENT_REJECTED',
                   'PAYMENT_REFUNDED', 'EXPIRY_7D', 'EXPIRY_3D', 'EXPIRY_1D', 'MEMBERSHIP_EXPIRED',
                   'TRAINER_ASSIGNED', 'WELCOME', 'ANNOUNCEMENT', 'STORAGE_ALERT')),
    message    TEXT    NOT NULL CHECK (length(message) BETWEEN 1 AND 300),
    status     TEXT    NOT NULL DEFAULT 'UNREAD' CHECK (status IN ('UNREAD', 'READ')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    read_at    TEXT
);
