-- SmartGym · 0009 · Automatic WhatsApp and email messages
-- Business events (a payment completed, an expiry reminder, an expired membership) queue a message
-- in the same step that records them; a scheduled job sends queued messages a few at a time
-- (the Free plan allows 50 outgoing requests per run) and records each result. Queued rows are
-- claimed atomically (QUEUED -> SENDING), so overlapping runs never send the same message twice.

-- A member can stop WhatsApp / email messages (staff on the member's page, or the member in the app).
ALTER TABLE members ADD COLUMN messages_opt_out INTEGER NOT NULL DEFAULT 0 CHECK (messages_opt_out IN (0, 1));

CREATE TABLE outbox (
    id          INTEGER PRIMARY KEY,
    channel     TEXT    NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL')),
    event       TEXT    NOT NULL,
    member_id   INTEGER REFERENCES members (id),
    recipient   TEXT    NOT NULL,
    -- JSON object with the message values (first name, gym, plan, amount, dates ...).
    params      TEXT    NOT NULL,
    -- One message per event, record and channel: re-running a job or approving twice adds nothing.
    dedupe_key  TEXT    NOT NULL UNIQUE,
    status      TEXT    NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    claimed_at  TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    sent_at     TEXT
);

-- Only unsent rows are indexed for the sender, so the index stays tiny.
CREATE INDEX idx_outbox_pending ON outbox (status, id) WHERE status IN ('QUEUED', 'SENDING');
-- Recent deliveries (admin screen) and the retention clean-up.
CREATE INDEX idx_outbox_created ON outbox (created_at);
