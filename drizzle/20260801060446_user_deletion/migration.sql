ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "target_author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "fk_comments_author", ADD CONSTRAINT "fk_comments_author" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;