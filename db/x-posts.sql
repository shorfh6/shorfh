-- Records which published articles were announced on X to keep posting idempotent.
CREATE TABLE IF NOT EXISTS article_x_posts (
  article_id integer PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  tweet_id text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);
