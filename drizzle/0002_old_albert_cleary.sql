CREATE TABLE `solutions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`selected_key` text,
	`operation_token` text,
	`expires` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_solutions_session` ON `solutions` (`session_id`);