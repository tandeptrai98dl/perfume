CREATE TYPE "public"."banner_placement" AS ENUM('home_hero', 'home_promo', 'category_top', 'announcement');--> statement-breakpoint
CREATE TABLE "banner_translations" (
	"banner_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"cta_label" text,
	"cta_url" text,
	"desktop_media_id" uuid,
	"mobile_media_id" uuid,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banner_translations_banner_id_locale_pk" PRIMARY KEY("banner_id","locale")
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"placement" "banner_placement" NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banners_schedule_check" CHECK ("banners"."starts_at" IS NULL OR "banners"."ends_at" IS NULL OR "banners"."ends_at" > "banners"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "navigation_menus" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"locale" "locale" NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "navigation_menus_key_locale_unique" UNIQUE("key","locale")
);
--> statement-breakpoint
CREATE TABLE "page_translations" (
	"page_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" jsonb,
	"seo_title" text,
	"seo_description" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_translations_page_id_locale_pk" PRIMARY KEY("page_id","locale"),
	CONSTRAINT "page_translations_locale_slug_unique" UNIQUE("locale","slug")
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "post_products" (
	"post_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "post_products_post_id_product_id_pk" PRIMARY KEY("post_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
	"post_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "post_translations" (
	"post_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"excerpt" text,
	"content" jsonb,
	"seo_title" text,
	"seo_description" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_translations_post_id_locale_pk" PRIMARY KEY("post_id","locale"),
	CONSTRAINT "post_translations_locale_slug_unique" UNIQUE("locale","slug")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid,
	"cover_media_id" uuid,
	"status" "publication_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" smallint DEFAULT 301 NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_fromPath_unique" UNIQUE("from_path"),
	CONSTRAINT "redirects_status_code_check" CHECK ("redirects"."status_code" IN (301, 302, 307, 308)),
	CONSTRAINT "redirects_no_self_check" CHECK ("redirects"."from_path" <> "redirects"."to_path")
);
--> statement-breakpoint
CREATE TABLE "tag_translations" (
	"tag_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_translations_tag_id_locale_pk" PRIMARY KEY("tag_id","locale"),
	CONSTRAINT "tag_translations_locale_slug_unique" UNIQUE("locale","slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "banner_translations" ADD CONSTRAINT "banner_translations_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_translations" ADD CONSTRAINT "banner_translations_desktop_media_id_media_id_fk" FOREIGN KEY ("desktop_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_translations" ADD CONSTRAINT "banner_translations_mobile_media_id_media_id_fk" FOREIGN KEY ("mobile_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_translations" ADD CONSTRAINT "page_translations_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_translations" ADD CONSTRAINT "post_translations_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_translations" ADD CONSTRAINT "tag_translations_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "banners_placement_is_active_position_index" ON "banners" USING btree ("placement","is_active","position");--> statement-breakpoint
CREATE INDEX "post_products_product_id_index" ON "post_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "post_tags_tag_id_index" ON "post_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "posts_status_published_at_index" ON "posts" USING btree ("status","published_at");--> statement-breakpoint
CREATE INDEX "redirects_to_path_index" ON "redirects" USING btree ("to_path");