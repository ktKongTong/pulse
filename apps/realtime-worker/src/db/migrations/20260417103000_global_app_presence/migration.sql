CREATE TABLE `global_app_daily_stats` (
  `id` text PRIMARY KEY NOT NULL,
  `day` text NOT NULL,
  `app_key` text NOT NULL,
  `label` text NOT NULL,
  `total_ms` integer DEFAULT 0 NOT NULL,
  `sample_count` integer DEFAULT 0 NOT NULL
);
