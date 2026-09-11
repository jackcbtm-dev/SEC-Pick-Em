-- Single-row JSON blob holding the whole app state (players, PIN hashes,
-- current week's games/picks/locks/winners, season history, and the
-- upcoming-weeks queue). Mirrors the shape the app used when it lived as a
-- self-publishing Claude artifact, so the entire client-side rendering layer
-- ports over unchanged -- only how state gets read/written changes.
CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
