-- Anúncios (decisões 73 a 79, RF-ADS, RN-ADS; docs/12-anuncios.md). Sem `BETTING` nem `ALCOHOL`
-- no enum de categorias (RN-ADS-01). Os eventos só somam contadores diários por peça, e os recibos
-- guardam o id aleatório da entrega, nunca usuário, aparelho ou IP (RN-ADS-03).
CREATE TYPE "public"."ad_advertiser_kind" AS ENUM('COMPANY', 'SPACE');--> statement-breakpoint
CREATE TYPE "public"."ad_campaign_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."ad_category" AS ENUM('SPORTING_GOODS', 'APPAREL', 'SUPPLEMENTS', 'FOOD_BEVERAGE', 'HEALTH', 'FITNESS', 'SPORTS_SPACE', 'EVENTS', 'SERVICES', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ad_destination_type" AS ENUM('URL', 'WHATSAPP', 'SPACE');--> statement-breakpoint
CREATE TYPE "public"."ad_event_type" AS ENUM('IMPRESSION', 'CLICK');--> statement-breakpoint
CREATE TYPE "public"."ad_placement" AS ENUM('EXPLORE_HERO', 'EXPLORE_FEED');--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"name" text NOT NULL,
	"placement" "ad_placement" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"city_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sport_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"weight" integer DEFAULT 5 NOT NULL,
	"status" "ad_campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_campaigns_period_valid" CHECK ("ad_campaigns"."ends_at" > "ad_campaigns"."starts_at"),
	CONSTRAINT "ad_campaigns_weight_range" CHECK ("ad_campaigns"."weight" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"image_url" text,
	"title" text NOT NULL,
	"body" text,
	"cta_label" text NOT NULL,
	"destination_type" "ad_destination_type" NOT NULL,
	"destination_url" text,
	"whatsapp_phone" text,
	"whatsapp_message" text,
	"destination_space_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_creatives_destination_valid" CHECK (COALESCE(CASE "ad_creatives"."destination_type"
        WHEN 'URL' THEN "ad_creatives"."destination_url" ~ '^https://[^[:space:]]+$'
          AND "ad_creatives"."whatsapp_phone" IS NULL AND "ad_creatives"."whatsapp_message" IS NULL
          AND "ad_creatives"."destination_space_id" IS NULL
        WHEN 'WHATSAPP' THEN "ad_creatives"."whatsapp_phone" ~ '^\+[1-9][0-9]{7,14}$'
          AND char_length("ad_creatives"."whatsapp_message") BETWEEN 1 AND 500
          AND "ad_creatives"."destination_url" IS NULL AND "ad_creatives"."destination_space_id" IS NULL
        WHEN 'SPACE' THEN "ad_creatives"."destination_space_id" IS NOT NULL
          AND "ad_creatives"."destination_url" IS NULL AND "ad_creatives"."whatsapp_phone" IS NULL
          AND "ad_creatives"."whatsapp_message" IS NULL
      END, false)),
	CONSTRAINT "ad_creatives_text_length" CHECK (char_length("ad_creatives"."title") BETWEEN 1 AND 40
        AND ("ad_creatives"."body" IS NULL OR char_length("ad_creatives"."body") BETWEEN 1 AND 90)
        AND char_length("ad_creatives"."cta_label") BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "ad_daily_stats" (
	"creative_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"placement" "ad_placement" NOT NULL,
	"day" date NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_daily_stats_pkey" PRIMARY KEY("creative_id","day"),
	CONSTRAINT "ad_daily_stats_counts_non_negative" CHECK ("ad_daily_stats"."impressions" >= 0 AND "ad_daily_stats"."clicks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ad_event_receipts" (
	"delivery_id" uuid NOT NULL,
	"kind" "ad_event_type" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_event_receipts_pkey" PRIMARY KEY("delivery_id","kind")
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"kind" "ad_advertiser_kind" NOT NULL,
	"space_id" uuid,
	"category" "ad_category" NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisers_space_kind" CHECK (("advertisers"."kind" = 'SPACE') = ("advertisers"."space_id" IS NOT NULL)),
	CONSTRAINT "advertisers_name_length" CHECK (char_length("advertisers"."name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_destination_space_id_spaces_id_fk" FOREIGN KEY ("destination_space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_daily_stats" ADD CONSTRAINT "ad_daily_stats_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_daily_stats" ADD CONSTRAINT "ad_daily_stats_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaigns_delivery_idx" ON "ad_campaigns" USING btree ("placement","status","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "ad_campaigns_advertiser_id_idx" ON "ad_campaigns" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_created_by_idx" ON "ad_campaigns" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "ad_creatives_campaign_id_position_idx" ON "ad_creatives" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "ad_creatives_destination_space_id_idx" ON "ad_creatives" USING btree ("destination_space_id");--> statement-breakpoint
CREATE INDEX "ad_daily_stats_campaign_id_day_idx" ON "ad_daily_stats" USING btree ("campaign_id","day");--> statement-breakpoint
CREATE INDEX "ad_event_receipts_expires_at_idx" ON "ad_event_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "advertisers_name_idx" ON "advertisers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_space_id_active_unique" ON "advertisers" USING btree ("space_id") WHERE "advertisers"."active" AND "advertisers"."space_id" IS NOT NULL;