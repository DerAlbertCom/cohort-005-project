ALTER TABLE `coupons` ADD `invalidated_at` text;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `revoked_at` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `refunds` ADD `seat_breakdown` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `decline_reason` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `refund_status` text;--> statement-breakpoint
ALTER TABLE `refunds` ADD `refund_status_at` text;--> statement-breakpoint
ALTER TABLE `refunds` DROP COLUMN `amount_refunded`;