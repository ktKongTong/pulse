ALTER TABLE `global_daily_stats` ADD `page_view_count` integer DEFAULT 0 NOT NULL;
ALTER TABLE `global_daily_stats` ADD `unique_visitor_count` integer DEFAULT 0 NOT NULL;

ALTER TABLE `page_daily_stats` ADD `unique_visitor_count` integer DEFAULT 0 NOT NULL;
ALTER TABLE `page_daily_stats` ADD `read_time_ms` integer DEFAULT 0 NOT NULL;
