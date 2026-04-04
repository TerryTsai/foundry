CREATE TABLE `account_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_capability_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`trigger` text NOT NULL,
	`state` text NOT NULL,
	`raw_response` text,
	`triggered_by_execution` text,
	FOREIGN KEY (`project_capability_id`) REFERENCES `project_capabilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`triggered_by_execution`) REFERENCES `capability_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_pc` ON `account_snapshots` (`project_capability_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`event` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_activity_project` ON `activity_log` (`project_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`content` text,
	`content_encoding` text,
	`blob_hash` text,
	`content_size` integer NOT NULL,
	`content_hash` text NOT NULL,
	`metadata` text,
	`snapshot_of` text,
	`supersedes` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "content_xor_blob" CHECK(("artifacts"."content" IS NOT NULL) != ("artifacts"."blob_hash" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_project` ON `artifacts` (`project_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_hash` ON `artifacts` (`content_hash`);--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`setup_guide` text NOT NULL,
	`config_schema` text NOT NULL,
	`is_builtin` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capabilities_name_unique` ON `capabilities` (`name`);--> statement-breakpoint
CREATE TABLE `capability_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`action_type` text NOT NULL,
	`script` text NOT NULL,
	`param_schema` text,
	`is_destructive` integer DEFAULT 0,
	`requires_approval` integer DEFAULT 0,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_capability_action` ON `capability_actions` (`capability_id`,`name`);--> statement-breakpoint
CREATE TABLE `capability_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_capability_id` text NOT NULL,
	`action_id` text NOT NULL,
	`params` text,
	`triggered_by` text NOT NULL,
	`executed_at` text NOT NULL,
	`status` text NOT NULL,
	`output` text,
	`error` text,
	`duration_ms` integer,
	FOREIGN KEY (`project_capability_id`) REFERENCES `project_capabilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`action_id`) REFERENCES `capability_actions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_executions_pc` ON `capability_executions` (`project_capability_id`,`executed_at`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`timestamp` text NOT NULL,
	`domain` text NOT NULL,
	`topic` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text NOT NULL,
	`alternatives` text,
	`made_by` text NOT NULL,
	`impact` text NOT NULL,
	`reversibility` text NOT NULL,
	`supersedes` text,
	`tags` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_decisions_project` ON `decisions` (`project_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_decisions_topic` ON `decisions` (`project_id`,`domain`,`topic`,`timestamp`);--> statement-breakpoint
CREATE TABLE `engine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`decisions_made` integer DEFAULT 0,
	`escalations_created` integer DEFAULT 0,
	`actions_executed` integer DEFAULT 0,
	`summary` text,
	`error` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_engine_runs_project` ON `engine_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `escalations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`domain` text NOT NULL,
	`topic` text NOT NULL,
	`draft_decision` text NOT NULL,
	`draft_rationale` text NOT NULL,
	`draft_alternatives` text,
	`impact` text NOT NULL,
	`created_at` text NOT NULL,
	`timeout_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`resolution` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_escalations_open` ON `escalations` (`project_id`,`resolved_at`);--> statement-breakpoint
CREATE TABLE `onboarding_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `onboarding_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `onboarding_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`project_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`credentials_enc` text,
	`credentials_iv` text,
	`credentials_tag` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_tested_at` text,
	`last_test_status` text,
	`last_test_output` text,
	`configured_at` text,
	`notes` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pc_project_capability` ON `project_capabilities` (`project_id`,`capability_id`);--> statement-breakpoint
CREATE INDEX `idx_pc_project` ON `project_capabilities` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`brief` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);