CREATE TABLE IF NOT EXISTS query_usage (
  customer_id UUID REFERENCES customers(id),
  month TEXT NOT NULL,
  count INT DEFAULT 0,
  PRIMARY KEY (customer_id, month)
);
