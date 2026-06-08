CREATE TABLE "users" (
	"id" uuid PRIMARY KEY,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text,
	"nickname" text NOT NULL CONSTRAINT "uq_users_nickname" UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_users_provider_account" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"platform" text NOT NULL,
	"device_name" text,
	"user_agent" text,
	"ip" text,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;