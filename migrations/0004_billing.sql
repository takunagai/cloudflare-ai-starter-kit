CREATE TABLE billing_customers (
  owner_id TEXT NOT NULL,
  server TEXT NOT NULL CHECK(server IN ('sandbox', 'production')),
  customer_id TEXT,
  PRIMARY KEY(owner_id, server),
  UNIQUE(customer_id, server)
);
CREATE TABLE billing_checkouts (
  owner_id TEXT NOT NULL,
  server TEXT NOT NULL,
  product_id TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('pending', 'ready', 'uncertain', 'expired', 'completed')),
  checkout_id TEXT,
  url TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, server, product_id),
  FOREIGN KEY(owner_id, server) REFERENCES billing_customers(owner_id, server)
);
CREATE TABLE billing_events (
  event_id TEXT NOT NULL,
  server TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(event_id, server)
);
CREATE TABLE billing_subscriptions (
  owner_id TEXT NOT NULL,
  server TEXT NOT NULL,
  subscription_id TEXT,
  product_id TEXT NOT NULL,
  status TEXT NOT NULL,
  period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  event_time INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  PRIMARY KEY(owner_id, server, product_id),
  FOREIGN KEY(owner_id, server) REFERENCES billing_customers(owner_id, server)
);
