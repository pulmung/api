CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_id" uuid,
	"mentioned_user_id" uuid,
	"content" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "comment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_comments_post" ON "comments" ("post_id","parent_id","id");--> statement-breakpoint
CREATE INDEX "idx_comments_parent" ON "comments" ("parent_id","id");--> statement-breakpoint
CREATE INDEX "idx_comments_author" ON "comments" ("author_id","id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_post" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_parent" FOREIGN KEY ("parent_id") REFERENCES "comments"("id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "fk_comments_mentioned_user" FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE SET NULL;