ALTER TABLE `project` ADD `workspace_toggles` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `project` ADD `workspace_toggles_version` integer NOT NULL DEFAULT 0;
