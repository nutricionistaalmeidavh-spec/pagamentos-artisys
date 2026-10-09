PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS offers (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL, name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', price_cents INTEGER NOT NULL CHECK(price_cents>0),
 currency TEXT NOT NULL DEFAULT 'BRL', sale_type TEXT NOT NULL DEFAULT 'one_time',
 delivery_mode TEXT NOT NULL DEFAULT 'manual', artifact_name TEXT,
 active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coupons (
 code TEXT PRIMARY KEY, percent_off INTEGER NOT NULL CHECK(percent_off BETWEEN 1 AND 90),
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, offer_id TEXT NOT NULL, product_id TEXT NOT NULL,
 customer_email TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '',
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 original_amount_cents INTEGER NOT NULL, coupon_code TEXT,
 currency TEXT NOT NULL DEFAULT 'BRL', sale_type TEXT NOT NULL,
 delivery_mode TEXT NOT NULL, artifact_name TEXT,
 status TEXT NOT NULL DEFAULT 'pending', payment_provider TEXT,
 checkout_id TEXT UNIQUE, checkout_url TEXT, checkout_state TEXT NOT NULL DEFAULT 'not_started',
 fulfillment_status TEXT NOT NULL DEFAULT 'not_started',
 subscription_id TEXT, access_hash TEXT NOT NULL,
 idem_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(customer_email, idem_key), FOREIGN KEY(offer_id) REFERENCES offers(id)
);
CREATE TABLE IF NOT EXISTS provider_events (
 id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'received', attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, next_attempt_at INTEGER NOT NULL DEFAULT 0,
 received_at TEXT NOT NULL, processed_at TEXT
);
CREATE TABLE IF NOT EXISTS fulfillments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'activate',
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, response_json TEXT, last_error TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(order_id, action), FOREIGN KEY(order_id) REFERENCES orders(id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL,
 details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status,created_at);
CREATE INDEX IF NOT EXISTS idx_events_queue ON provider_events(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_fulfill_queue ON fulfillments(status,next_attempt_at);
