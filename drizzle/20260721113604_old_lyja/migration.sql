CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY,
	"author_id" uuid NOT NULL,
	"plant_id" uuid,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"excerpt" text NOT NULL,
	"thumbnail_key" text,
	"image_keys" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_posts_author" ON "posts" ("author_id","id");--> statement-breakpoint
CREATE INDEX "idx_posts_plant" ON "posts" ("plant_id","id");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_plant" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE SET NULL;