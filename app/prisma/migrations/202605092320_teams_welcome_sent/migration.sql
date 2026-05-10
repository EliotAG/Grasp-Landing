-- Track once-only delivery of the bot self-introduction so we don't
-- double-send when both `installationUpdate.add` and the legacy
-- `conversationUpdate.membersAdded` event fire on install.
ALTER TABLE "teams_conversation_reference"
  ADD COLUMN "welcome_sent_at" TIMESTAMP(3);
