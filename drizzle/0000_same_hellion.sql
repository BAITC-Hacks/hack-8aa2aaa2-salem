CREATE TABLE `cart` (
	`session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_json` text NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`session_id`, `product_id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_pages` (
	`page` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content_json` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messages_session_created` ON `messages` (`session_id`,`created`);--> statement-breakpoint
CREATE TABLE `product_details` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`product_id` text NOT NULL,
	`product_json` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` real NOT NULL,
	`status` text NOT NULL,
	`operation_token` text,
	`expires` integer NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_proposals_session` ON `proposals` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`last_product` text,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
