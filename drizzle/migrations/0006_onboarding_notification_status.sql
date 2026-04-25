-- Add notification status tracking to onboarding stage instances.
-- notifiedAt: when the previous stage owner pressed "Notify next stage"
-- notificationReceivedAt: when the next stage owner clicked "Mark as received"
-- notificationSkipped: true when the notifier pressed "Skip message"

ALTER TABLE `onboardingStageInstances`
  ADD COLUMN `notifiedAt` TIMESTAMP NULL AFTER `completedAt`,
  ADD COLUMN `notificationReceivedAt` TIMESTAMP NULL AFTER `notifiedAt`,
  ADD COLUMN `notificationSkipped` BOOLEAN NOT NULL DEFAULT FALSE AFTER `notificationReceivedAt`;
