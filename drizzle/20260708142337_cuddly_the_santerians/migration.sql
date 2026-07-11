CREATE TABLE "user_plants" (
	"id" uuid PRIMARY KEY,
	"owner_id" uuid NOT NULL,
	"plant_id" uuid,
	"name" text NOT NULL,
	"images" jsonb NOT NULL,
	"adopted_at" date,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_user_plants_owner" ON "user_plants" ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_user_plants_plant" ON "user_plants" ("plant_id");--> statement-breakpoint
ALTER TABLE "user_plants" ADD CONSTRAINT "user_plants_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_plants" ADD CONSTRAINT "fk_user_plants_plant" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE SET NULL;