CREATE TABLE "developer_application" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE "developer_invite" (
	"code" text PRIMARY KEY,
	"owner_id" text,
	"created_by" text NOT NULL,
	"used_by" text,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "developer_invite_used_pair" CHECK (("used_by" IS NULL) = ("used_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "developer" (
	"user_id" text PRIMARY KEY,
	"source" text NOT NULL,
	"source_ref" text,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "fuel_account" (
	"owner_id" text,
	"month" text,
	"used" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"rate_version" integer NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"holding_billed_on" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_account_pkey" PRIMARY KEY("owner_id","month"),
	CONSTRAINT "fuel_account_nonneg" CHECK ("used" >= 0 AND "reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tool_usage" (
	"tool_id" text,
	"owner_id" text NOT NULL,
	"day" text,
	"runs" integer DEFAULT 0 NOT NULL,
	"ok" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"run_ms" bigint DEFAULT 0 NOT NULL,
	"posts" integer DEFAULT 0 NOT NULL,
	"storage_writes" integer DEFAULT 0 NOT NULL,
	"storage_write_bytes" bigint DEFAULT 0 NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "tool_usage_pkey" PRIMARY KEY("tool_id","day")
);
--> statement-breakpoint
ALTER TABLE "tool_run" ADD COLUMN "fuel_month" text;--> statement-breakpoint
ALTER TABLE "tool_run" ADD COLUMN "fuel_reserved" integer;--> statement-breakpoint
ALTER TABLE "tool_run" ADD COLUMN "fuel_charged" integer;--> statement-breakpoint
ALTER TABLE "tool_version" ADD COLUMN "package_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "circle_tool" DROP COLUMN "requests";--> statement-breakpoint
CREATE UNIQUE INDEX "developer_application_pending_uidx" ON "developer_application" ("user_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "developer_application_status_idx" ON "developer_application" ("status","created_at");--> statement-breakpoint
CREATE INDEX "developer_application_user_idx" ON "developer_application" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "developer_invite_owner_idx" ON "developer_invite" ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_usage_owner_day_idx" ON "tool_usage" ("owner_id","day");--> statement-breakpoint
ALTER TABLE "developer_application" ADD CONSTRAINT "developer_application_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer_application" ADD CONSTRAINT "developer_application_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer_invite" ADD CONSTRAINT "developer_invite_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer_invite" ADD CONSTRAINT "developer_invite_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer_invite" ADD CONSTRAINT "developer_invite_used_by_user_id_fkey" FOREIGN KEY ("used_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer" ADD CONSTRAINT "developer_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer" ADD CONSTRAINT "developer_granted_by_user_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "developer" ADD CONSTRAINT "developer_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "fuel_account" ADD CONSTRAINT "fuel_account_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "tool_usage" ADD CONSTRAINT "tool_usage_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "tool_usage" ADD CONSTRAINT "tool_usage_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id");