CREATE TABLE "waterings" (
	"id" uuid PRIMARY KEY,
	"user_plant_id" uuid NOT NULL,
	"watered_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_waterings_plant_date" UNIQUE("user_plant_id","watered_on")
);
--> statement-breakpoint
ALTER TABLE "user_plants" ADD COLUMN "watering_interval_days" integer;--> statement-breakpoint
ALTER TABLE "waterings" ADD CONSTRAINT "fk_waterings_user_plant" FOREIGN KEY ("user_plant_id") REFERENCES "user_plants"("id") ON DELETE CASCADE;