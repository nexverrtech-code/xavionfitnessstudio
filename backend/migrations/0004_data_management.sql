-- SmartGym · 0004 · Backup, archive and storage monitoring
-- Backup files themselves are never stored in D1: the admin downloads them. These tables
-- only hold the small audit trail and daily storage figures.

-- One row per backup / archive run, restore, or Time Travel restore.
--   BACKUP:      CREATED -> VERIFIED -> ARCHIVING -> ARCHIVED   (or CANCELLED)
--   RESTORE:     COMPLETED
--   TIME_TRAVEL: COMPLETED
CREATE TABLE backups (
    id             INTEGER PRIMARY KEY,
    kind           TEXT    NOT NULL CHECK (kind IN ('BACKUP', 'RESTORE', 'TIME_TRAVEL')),
    status         TEXT    NOT NULL CHECK (status IN ('CREATED', 'VERIFIED', 'ARCHIVING', 'ARCHIVED', 'CANCELLED', 'COMPLETED')),
    -- Comma-separated data sets, e.g. 'attendance,payments'.
    tables         TEXT    NOT NULL CHECK (length(tables) <= 200),
    period_from    TEXT    CHECK (period_from IS NULL OR length(period_from) = 10),
    period_to      TEXT    CHECK (period_to IS NULL OR length(period_to) = 10),
    -- Highest row id per table at backup time ('attendance:1234,payments:77'): an archive
    -- never removes rows added after the backup was taken.
    watermarks     TEXT    CHECK (watermarks IS NULL OR length(watermarks) <= 400),
    record_count   INTEGER NOT NULL DEFAULT 0,
    file_name      TEXT    CHECK (file_name IS NULL OR length(file_name) <= 120),
    checksum       TEXT    CHECK (checksum IS NULL OR length(checksum) <= 64),
    notes          TEXT    CHECK (notes IS NULL OR length(notes) <= 200),
    created_by     INTEGER REFERENCES users (id),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    verified_by    INTEGER REFERENCES users (id),
    verified_at    TEXT,
    archived_by    INTEGER REFERENCES users (id),
    archived_at    TEXT,
    archived_count INTEGER NOT NULL DEFAULT 0,
    CHECK (period_from IS NULL OR period_to IS NULL OR period_to >= period_from)
);

-- Daily database size and row counts (written by the daily job) for growth trends.
CREATE TABLE storage_snapshots (
    snapshot_date TEXT    PRIMARY KEY CHECK (length(snapshot_date) = 10),
    db_bytes      INTEGER NOT NULL CHECK (db_bytes >= 0),
    row_counts    TEXT    NOT NULL CHECK (length(row_counts) <= 600),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
