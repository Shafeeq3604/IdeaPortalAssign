-- CreateEnum
CREATE TYPE "NotificationEmailStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "email_attempted_at" TIMESTAMPTZ(3),
ADD COLUMN     "email_status" "NotificationEmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED';

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","event")
);

-- CreateIndex
CREATE INDEX "notifications_email_status_created_at_idx" ON "notifications"("email_status", "created_at");
