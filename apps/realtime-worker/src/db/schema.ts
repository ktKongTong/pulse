import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ==========================================
// DeviceDO 专属 Schema
// ==========================================

export const presenceEvents = sqliteTable('presence_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(), // 'FOCUS' | 'MEDIA'
  appName: text('app_name').notNull(),
  metadata: text('metadata', { mode: 'json' }), // JSON stored as text
  durationMs: integer('duration_ms').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const deviceDailyStats = sqliteTable('device_daily_stats', {
  id: text('id').primaryKey(), // "day|deviceId"
  day: text('day').notNull(),
  deviceId: text('device_id').notNull(),
  focusSwitchCount: integer('focus_switch_count').default(0).notNull(),
  mediaSwitchCount: integer('media_switch_count').default(0).notNull(),
  sessionCount: integer('session_count').default(0).notNull(),
});


// ==========================================
// RoomDO 专属 Schema
// ==========================================

export const chatMessages = sqliteTable('chat_messages', {
  msgId: text('msg_id').primaryKey(),
  senderId: text('sender_id').notNull(),
  senderDisplayName: text('sender_display_name').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const globalDailyStats = sqliteTable('global_daily_stats', {
  day: text('day').primaryKey(),
  startedAtMs: integer('started_at_ms').notNull(),
  lastUpdatedAtMs: integer('last_updated_at_ms').notNull(),
  pageViewCount: integer('page_view_count').default(0).notNull(),
  uniqueVisitorCount: integer('unique_visitor_count').default(0).notNull(),
  onlineIntegralMs: integer('online_integral_ms').default(0).notNull(),
  onlineCountPeak: integer('online_count_peak').default(0).notNull(),
  activeDeviceCountPeak: integer('active_device_count_peak').default(0).notNull(),
  activeWebReaderCountPeak: integer('active_web_reader_count_peak').default(0).notNull(),
  dedupedEventCount: integer('deduped_event_count').default(0).notNull(),
  rejectedEventCount: integer('rejected_event_count').default(0).notNull(),
  broadcastCount: integer('broadcast_count').default(0).notNull(),
});

export const globalAppDailyStats = sqliteTable('global_app_daily_stats', {
  id: text('id').primaryKey(), // "day|appKey"
  day: text('day').notNull(),
  appKey: text('app_key').notNull(),
  label: text('label').notNull(),
  totalMs: integer('total_ms').default(0).notNull(),
  sampleCount: integer('sample_count').default(0).notNull(),
});

export const pageDailyStats = sqliteTable('page_daily_stats', {
  id: text('id').primaryKey(), // "2026-04-14|https://example.com"
  day: text('day').notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  title: text('title').notNull(),
  startedAtMs: integer('started_at_ms').notNull(),
  lastUpdatedAtMs: integer('last_updated_at_ms').notNull(),
  pageViewCount: integer('page_view_count').default(0).notNull(),
  uniqueVisitorCount: integer('unique_visitor_count').default(0).notNull(),
  readTimeMs: integer('read_time_ms').default(0).notNull(),
  readerSessionCount: integer('reader_session_count').default(0).notNull(),
  progressSum: real('progress_sum').default(0).notNull(),
  progressSamples: integer('progress_samples').default(0).notNull(),
  maxProgressPercent: real('max_progress_percent').default(0).notNull(),
  bounceCount: integer('bounce_count').default(0).notNull(),
  engagedReaderCount: integer('engaged_reader_count').default(0).notNull(),
});

export const roomDailyStats = sqliteTable('room_daily_stats', {
  id: text('id').primaryKey(), // "day|roomId"
  day: text('day').notNull(),
  roomId: text('room_id').notNull(),
  startedAtMs: integer('started_at_ms').notNull(),
  lastUpdatedAtMs: integer('last_updated_at_ms').notNull(),
  onlineIntegralMs: integer('online_integral_ms').default(0).notNull(),
  onlineCountPeak: integer('online_count_peak').default(0).notNull(),
  deviceReaderCount: integer('device_reader_count').default(0).notNull(),
  webReaderCount: integer('web_reader_count').default(0).notNull(),
  entryCount: integer('entry_count').default(0).notNull(),
  exitCount: integer('exit_count').default(0).notNull(),
});

// We keep active_readers table for RoomDO tracking web visitors natively if needed
export const activeReaders = sqliteTable('active_readers', {
  readerId: text('reader_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  roomId: text('room_id').notNull(),
  userId: text('user_id'),
  source: text('source').notNull(),
  displayName: text('display_name').notNull(),
  presenceState: text('presence_state').notNull(),
  pageTitle: text('page_title'),
  pageUrl: text('page_url'),
  pageCanonicalUrl: text('page_canonical_url'),
  readingProgressPercent: real('reading_progress_percent'),
  readingScrollY: real('reading_scroll_y'),
  updatedAt: text('updated_at').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
});
