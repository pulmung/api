CREATE TABLE "user_blocks" (
	"blocker_id" uuid,
	"blocked_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_user_blocks" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY,
	"reporter_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_author_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_reports_reporter_target" UNIQUE("reporter_id","target_type","target_id")
);
--> statement-breakpoint
CREATE INDEX "idx_user_blocks_blocked" ON "user_blocks" ("blocked_id","blocker_id");--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "fk_user_blocks_blocker" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "fk_user_blocks_blocked" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "fk_reports_reporter" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL;