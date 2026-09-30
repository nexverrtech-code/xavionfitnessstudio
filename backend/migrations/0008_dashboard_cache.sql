-- SmartGym · 0008 · Dashboard chart cache
-- The dashboard charts cover months and days that are already over. Those totals are computed at
-- most once a day and kept here as one small JSON row; only today and the current month are read
-- live. With thousands of members this keeps a dashboard visit cheap in D1 rows read.
-- Nothing here is business data: rows are rebuilt on demand and older ones are cleared.

CREATE TABLE dashboard_cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
