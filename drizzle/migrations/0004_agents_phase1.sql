-- Phase 1 — Agents foundation
-- Boards (department kanbans), on-call schedule, Slack bot identities,
-- and task-level board/visibility/owner columns.

-- ── Boards ──────────────────────────────────────────────────────────────
CREATE TABLE `boards` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(64) NOT NULL UNIQUE,
  `name` VARCHAR(128) NOT NULL,
  `department` ENUM('leisr_ops','leisr_mgmt','fivestr_ops') NOT NULL,
  `agent` ENUM('wanda','starry') NOT NULL,
  `sourcesEnabled` JSON NULL,
  `columnConfig` JSON NULL,
  `slackChannelId` VARCHAR(64) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO `boards` (`slug`, `name`, `department`, `agent`, `sourcesEnabled`, `isActive`) VALUES
  ('leisr_ops',   'Leisr Ops',   'leisr_ops',   'wanda',
    JSON_OBJECT('guestMessages', TRUE, 'reviews', TRUE, 'breezeway', TRUE, 'slack', TRUE, 'gmail', TRUE), TRUE),
  ('leisr_mgmt',  'Leisr Mgmt',  'leisr_mgmt',  'wanda',
    JSON_OBJECT('slack', TRUE, 'gmail', TRUE), TRUE),
  ('fivestr_ops', '5STR Ops',    'fivestr_ops', 'starry',
    JSON_OBJECT('breezeway', TRUE, 'slack', TRUE, 'openphone', TRUE), TRUE);

-- ── On-Call Schedule ────────────────────────────────────────────────────
CREATE TABLE `onCallSchedule` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `department` ENUM('leisr_ops','leisr_mgmt','fivestr_ops') NOT NULL,
  `role` VARCHAR(64) NOT NULL DEFAULT 'primary',
  `userId` INT NOT NULL,
  `startsAt` TIMESTAMP NOT NULL,
  `endsAt` TIMESTAMP NOT NULL,
  `notes` TEXT NULL,
  `slackUserId` VARCHAR(64) NULL,
  `createdBy` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_oncall_dept_window` (`department`, `startsAt`, `endsAt`)
);

-- ── Slack Bots + User Links ─────────────────────────────────────────────
CREATE TABLE `slackBots` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `agent` ENUM('wanda','starry') NOT NULL UNIQUE,
  `workspaceId` VARCHAR(64) NOT NULL,
  `botUserId` VARCHAR(64) NOT NULL,
  `botTokenRef` VARCHAR(128) NOT NULL,
  `signingSecretRef` VARCHAR(128) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE `slackUserLinks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `workspaceId` VARCHAR(64) NOT NULL,
  `slackUserId` VARCHAR(64) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_slack_user` (`workspaceId`, `slackUserId`),
  INDEX `idx_slack_user_user` (`userId`)
);

-- ── Tasks: board / visibility / owner columns ───────────────────────────
ALTER TABLE `tasks`
  ADD COLUMN `boardId` INT NULL,
  ADD COLUMN `visibility` ENUM('board','private') NOT NULL DEFAULT 'board',
  ADD COLUMN `ownerUserId` INT NULL,
  ADD COLUMN `ownerAgent` ENUM('wanda','starry') NULL;

CREATE INDEX `idx_tasks_board` ON `tasks` (`boardId`);
CREATE INDEX `idx_tasks_owner` ON `tasks` (`ownerUserId`);

-- Backfill: every existing task → "Leisr Ops" board (current default kanban)
UPDATE `tasks`
   SET `boardId` = (SELECT `id` FROM `boards` WHERE `slug` = 'leisr_ops')
 WHERE `boardId` IS NULL;
