CREATE TABLE IF NOT EXISTS `active_readers` (
	`reader_id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`room_id` text NOT NULL,
	`user_id` text,
	`source` text NOT NULL,
	`display_name` text NOT NULL,
	`presence_state` text NOT NULL,
	`page_title` text,
	`page_url` text,
	`page_canonical_url` text,
	`reading_progress_percent` real,
	`reading_scroll_y` real,
	`updated_at` text NOT NULL,
	`expires_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_messages` (
	`msg_id` text PRIMARY KEY,
	`sender_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `device_daily_stats` (
	`id` text PRIMARY KEY,
	`day` text NOT NULL,
	`device_id` text NOT NULL,
	`focus_switch_count` integer DEFAULT 0 NOT NULL,
	`media_switch_count` integer DEFAULT 0 NOT NULL,
	`session_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `global_daily_stats` (
	`day` text PRIMARY KEY,
	`started_at_ms` integer NOT NULL,
	`last_updated_at_ms` integer NOT NULL,
	`online_integral_ms` integer DEFAULT 0 NOT NULL,
	`online_count_peak` integer DEFAULT 0 NOT NULL,
	`active_device_count_peak` integer DEFAULT 0 NOT NULL,
	`active_web_reader_count_peak` integer DEFAULT 0 NOT NULL,
	`deduped_event_count` integer DEFAULT 0 NOT NULL,
	`rejected_event_count` integer DEFAULT 0 NOT NULL,
	`broadcast_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `page_daily_stats` (
	`id` text PRIMARY KEY,
	`day` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`last_updated_at_ms` integer NOT NULL,
	`page_view_count` integer DEFAULT 0 NOT NULL,
	`reader_session_count` integer DEFAULT 0 NOT NULL,
	`progress_sum` real DEFAULT 0 NOT NULL,
	`progress_samples` integer DEFAULT 0 NOT NULL,
	`max_progress_percent` real DEFAULT 0 NOT NULL,
	`bounce_count` integer DEFAULT 0 NOT NULL,
	`engaged_reader_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `presence_events` (
	`id` text PRIMARY KEY,
	`event_type` text NOT NULL,
	`app_name` text NOT NULL,
	`metadata` text,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `room_daily_stats` (
	`id` text PRIMARY KEY,
	`day` text NOT NULL,
	`room_id` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`last_updated_at_ms` integer NOT NULL,
	`online_integral_ms` integer DEFAULT 0 NOT NULL,
	`online_count_peak` integer DEFAULT 0 NOT NULL,
	`device_reader_count` integer DEFAULT 0 NOT NULL,
	`web_reader_count` integer DEFAULT 0 NOT NULL,
	`entry_count` integer DEFAULT 0 NOT NULL,
	`exit_count` integer DEFAULT 0 NOT NULL
);
