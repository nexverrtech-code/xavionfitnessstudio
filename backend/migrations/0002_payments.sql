-- SmartGym · 0002 · Payments and refunds
-- No payment gateway in Version 1: cash, direct UPI (UTR verified by staff), bank transfer
-- and card payments taken on the gym's own terminal (recorded manually).
-- Never stored: card numbers, CVV, PINs, UPI PINs, bank credentials, screenshots or large JSON.

CREATE TABLE payments (
    id                    INTEGER PRIMARY KEY,
    -- Internal number shown to people (PAY-2026-000001). Never the UTR.
    payment_number        TEXT    NOT NULL UNIQUE CHECK (length(payment_number) BETWEEN 10 AND 20),
    member_id             INTEGER NOT NULL REFERENCES members (id),
    -- Set when the payment is confirmed and the membership is created.
    membership_id         INTEGER REFERENCES memberships (id),
    -- The plan being paid for (a PENDING UPI payment has no membership yet).
    plan_id               INTEGER NOT NULL REFERENCES membership_plans (id),
    amount                INTEGER NOT NULL CHECK (amount > 0),
    payment_method        TEXT    NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD_MANUAL')),
    -- UTR for UPI, bank reference for transfers, optional slip number for card.
    transaction_reference TEXT    CHECK (transaction_reference IS NULL OR length(transaction_reference) BETWEEN 4 AND 64),
    status                TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'REJECTED', 'FAILED', 'REFUNDED')),
    payment_date          TEXT    NOT NULL CHECK (length(payment_date) = 10),
    verified_by           INTEGER REFERENCES users (id),
    verified_at           TEXT,
    notes                 TEXT    CHECK (notes IS NULL OR length(notes) <= 200),
    -- Client-generated key that makes recording a payment safe to retry or double-click.
    idempotency_key       TEXT    CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 64),
    created_by            INTEGER REFERENCES users (id),
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (status NOT IN ('PAID', 'REFUNDED') OR (membership_id IS NOT NULL AND verified_at IS NOT NULL)),
    CHECK (payment_method NOT IN ('UPI', 'BANK_TRANSFER') OR transaction_reference IS NOT NULL)
);

-- Refunds are only RECORDED: money goes back outside SmartGym (cash, UPI, bank).
CREATE TABLE refunds (
    id               INTEGER PRIMARY KEY,
    payment_id       INTEGER NOT NULL UNIQUE REFERENCES payments (id),
    amount           INTEGER NOT NULL CHECK (amount > 0),
    refund_method    TEXT    NOT NULL CHECK (refund_method IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CARD_MANUAL')),
    refund_reference TEXT    CHECK (refund_reference IS NULL OR length(refund_reference) BETWEEN 4 AND 64),
    refund_reason    TEXT    NOT NULL CHECK (length(refund_reason) BETWEEN 3 AND 200),
    refund_date      TEXT    NOT NULL CHECK (length(refund_date) = 10),
    created_by       INTEGER REFERENCES users (id),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
