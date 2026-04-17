ALTER TABLE `chat_messages`
ADD COLUMN `sender_display_name` text NOT NULL DEFAULT 'Anonymous';
