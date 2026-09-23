ALTER TABLE `sessions` ADD `conversation_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `completed_at` integer;