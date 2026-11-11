CREATE TYPE "public"."cart_status" AS ENUM('active', 'converted', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'committed', 'released');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('system', 'customer', 'staff');--> statement-breakpoint
CREATE TYPE "public"."order_address_type" AS ENUM('shipping', 'billing');--> statement-breakpoint
CREATE TYPE "public"."order_source" AS ENUM('web', 'admin');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'awaiting_confirmation', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'delivery_failed', 'return_requested', 'returned');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cod', 'vnpay', 'payos', 'bank_transfer', 'momo', 'zalopay');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('pending', 'succeeded', 'failed', 'expired', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('full', 'deposit', 'balance', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('cod', 'vnpay', 'payos', 'bank_manual', 'momo', 'zalopay');--> statement-breakpoint
CREATE TYPE "public"."refund_method" AS ENUM('gateway', 'bank_transfer', 'cash');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('percent', 'fixed', 'free_shipping');--> statement-breakpoint
CREATE TYPE "public"."carrier" AS ENUM('self', 'ghn', 'ghtk', 'viettel_post', 'other');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'in_transit', 'delivered', 'failed', 'returned');--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price_when_added" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_cartId_variantId_unique" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_items_quantity_check" CHECK ("cart_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"token_hash" text,
	"locale" "locale" DEFAULT 'vi' NOT NULL,
	"status" "cart_status" DEFAULT 'active' NOT NULL,
	"coupon_code" text,
	"gift_wrap" boolean DEFAULT false NOT NULL,
	"gift_message" text,
	"hide_prices" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "carts_owner_check" CHECK ("carts"."user_id" IS NOT NULL OR "carts"."token_hash" IS NOT NULL),
	CONSTRAINT "carts_gift_message_length" CHECK (char_length("carts"."gift_message") <= 200)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_reservations_quantity_check" CHECK ("stock_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_addresses" (
	"order_id" uuid NOT NULL,
	"type" "order_address_type" NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"province_code" text NOT NULL,
	"province_name" text NOT NULL,
	"ward_code" text NOT NULL,
	"ward_name" text NOT NULL,
	"legacy_district" text,
	"street" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_addresses_order_id_type_pk" PRIMARY KEY("order_id","type")
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"message" text,
	"diff" jsonb,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"variant_label" text NOT NULL,
	"sku" text NOT NULL,
	"image_url" text,
	"unit_price" bigint NOT NULL,
	"compare_at_price" bigint,
	"quantity" integer NOT NULL,
	"discount_allocated" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid,
	"email" "citext" NOT NULL,
	"phone" text NOT NULL,
	"customer_name" text NOT NULL,
	"locale" "locale" NOT NULL,
	"source" "order_source" DEFAULT 'web' NOT NULL,
	"created_by" uuid,
	"status" "order_status" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount_total" bigint DEFAULT 0 NOT NULL,
	"shipping_fee" bigint DEFAULT 0 NOT NULL,
	"gift_wrap_fee" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"deposit_required" bigint DEFAULT 0 NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"amount_refunded" bigint DEFAULT 0 NOT NULL,
	"amount_due" bigint GENERATED ALWAYS AS (total - amount_paid) STORED NOT NULL,
	"coupon_code" text,
	"gift_wrap" boolean DEFAULT false NOT NULL,
	"gift_message" text,
	"hide_prices" boolean DEFAULT false NOT NULL,
	"customer_note" text,
	"internal_note" text,
	"vat_invoice" jsonb,
	"einvoice_ref" text,
	"einvoice_issued_at" timestamp with time zone,
	"checkout_key" text,
	"shipping_rate_id" uuid,
	"ip_address" "inet",
	"user_agent" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_code_unique" UNIQUE("code"),
	CONSTRAINT "orders_checkoutKey_unique" UNIQUE("checkout_key"),
	CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal" >= 0 AND "orders"."discount_total" >= 0 AND "orders"."shipping_fee" >= 0
        AND "orders"."gift_wrap_fee" >= 0 AND "orders"."total" >= 0 AND "orders"."amount_paid" >= 0
        AND "orders"."amount_refunded" >= 0 AND "orders"."deposit_required" >= 0),
	CONSTRAINT "orders_gift_message_length" CHECK (char_length("orders"."gift_message") <= 200)
);
--> statement-breakpoint
CREATE TABLE "cod_remittance_orders" (
	"remittance_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "cod_remittance_orders_remittance_id_order_id_pk" PRIMARY KEY("remittance_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "cod_remittances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"carrier" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_amount" bigint NOT NULL,
	"carrier_fee" bigint DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"bank_reference" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payment_id" uuid,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'pending' NOT NULL,
	"txn_ref" text NOT NULL,
	"provider_txn_id" text,
	"bank_code" text,
	"checkout_url" text,
	"qr_code" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"confirmed_by" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_txnRef_unique" UNIQUE("txn_ref"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"method" "refund_method" NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"provider_ref" text,
	"proof_media_id" uuid,
	"actor_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"phone" text NOT NULL,
	"email" "citext" NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_orderId_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" "citext" NOT NULL,
	"type" "coupon_type" NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"max_discount" bigint,
	"min_subtotal" bigint,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exclude_sale_items" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_value_check" CHECK ("coupons"."value" >= 0 AND ("coupons"."type" <> 'percent' OR "coupons"."value" BETWEEN 1 AND 100))
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" "carrier" NOT NULL,
	"tracking_code" text NOT NULL,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"cod_amount" bigint DEFAULT 0 NOT NULL,
	"fee_actual" bigint,
	"label_url" text,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipping_rate_translations" (
	"rate_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rate_translations_rate_id_locale_pk" PRIMARY KEY("rate_id","locale")
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"min_weight_g" integer DEFAULT 0 NOT NULL,
	"max_weight_g" integer,
	"fee" bigint NOT NULL,
	"free_over_subtotal" bigint,
	"eta_min_days" integer NOT NULL,
	"eta_max_days" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_bounds_check" CHECK ("shipping_rates"."fee" >= 0 AND "shipping_rates"."min_weight_g" >= 0 AND ("shipping_rates"."max_weight_g" IS NULL OR "shipping_rates"."max_weight_g" > "shipping_rates"."min_weight_g")
        AND "shipping_rates"."eta_min_days" >= 0 AND "shipping_rates"."eta_max_days" >= "shipping_rates"."eta_min_days")
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"province_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittance_orders" ADD CONSTRAINT "cod_remittance_orders_remittance_id_cod_remittances_id_fk" FOREIGN KEY ("remittance_id") REFERENCES "public"."cod_remittances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittance_orders" ADD CONSTRAINT "cod_remittance_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittances" ADD CONSTRAINT "cod_remittances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_proof_media_id_media_id_fk" FOREIGN KEY ("proof_media_id") REFERENCES "public"."media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rate_translations" ADD CONSTRAINT "shipping_rate_translations_rate_id_shipping_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."shipping_rates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_user_id_status_index" ON "carts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "carts_status_expires_at_index" ON "carts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "stock_reservations_status_expires_at_index" ON "stock_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "stock_reservations_order_id_index" ON "stock_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_id_created_at_index" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_id_index" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_variant_id_index" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_status_placed_at_index" ON "orders" USING btree ("status","placed_at");--> statement-breakpoint
CREATE INDEX "orders_payment_status_index" ON "orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "orders_user_id_placed_at_index" ON "orders" USING btree ("user_id","placed_at");--> statement-breakpoint
CREATE INDEX "orders_phone_index" ON "orders" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "orders_email_index" ON "orders" USING btree ("email");--> statement-breakpoint
CREATE INDEX "orders_placed_at_index" ON "orders" USING btree ("placed_at");--> statement-breakpoint
CREATE INDEX "cod_remittance_orders_order_id_index" ON "cod_remittance_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "cod_remittances_received_at_index" ON "cod_remittances" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "payment_events_payment_id_index" ON "payment_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_events_created_at_index" ON "payment_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payments_order_id_index" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_status_expires_at_index" ON "payments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "refunds_order_id_index" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_status_index" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_id_phone_index" ON "coupon_redemptions" USING btree ("coupon_id","phone");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_id_email_index" ON "coupon_redemptions" USING btree ("coupon_id","email");--> statement-breakpoint
CREATE INDEX "shipments_order_id_index" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_carrier_tracking_code_index" ON "shipments" USING btree ("carrier","tracking_code");--> statement-breakpoint
CREATE INDEX "shipping_rates_zone_id_is_active_index" ON "shipping_rates" USING btree ("zone_id","is_active");