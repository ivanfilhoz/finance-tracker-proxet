CREATE TABLE "budget_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"budget_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period_start" date NOT NULL,
	"state" text DEFAULT 'attempted' NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "budget_notification_month_start" CHECK (extract(day from "budget_notifications"."period_start") = 1),
	CONSTRAINT "budget_notification_state" CHECK ("budget_notifications"."state" in ('attempted', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category_id" text NOT NULL,
	"currency" text NOT NULL,
	"limit_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_positive_limit" CHECK ("budgets"."limit_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "budget_notifications" ADD CONSTRAINT "budget_notifications_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_notifications" ADD CONSTRAINT "budget_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_notification_period_unique" ON "budget_notifications" USING btree ("budget_id","period_start");--> statement-breakpoint
CREATE INDEX "budget_notification_user_idx" ON "budget_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_category_unique" ON "budgets" USING btree ("user_id","category_id");