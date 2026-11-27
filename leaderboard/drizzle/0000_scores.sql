CREATE TABLE scores (
  map TEXT NOT NULL,
  player TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (map, player)
);
--> statement-breakpoint
CREATE INDEX scores_by_map ON scores (map, score DESC, player);
