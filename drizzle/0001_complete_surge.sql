CREATE TABLE `agent_locks` (
	`session_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
