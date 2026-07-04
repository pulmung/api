CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "genera" (
	"name" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plants" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL CONSTRAINT "uq_plants_name" UNIQUE,
	"images" jsonb NOT NULL,
	"genus" text,
	"species" text,
	"category" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "species" (
	"genus" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_species" PRIMARY KEY("genus","name")
);
--> statement-breakpoint
CREATE INDEX "idx_plants_name_trgm" ON "plants" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_plants_genus_trgm" ON "plants" USING gin ("genus" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_plants_species_trgm" ON "plants" USING gin ("species" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_created_by_id_users_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_genus_genera_name_fkey" FOREIGN KEY ("genus") REFERENCES "genera"("name") ON DELETE RESTRICT ON UPDATE CASCADE;