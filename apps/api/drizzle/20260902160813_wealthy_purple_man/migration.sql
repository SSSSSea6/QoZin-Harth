CREATE TABLE "circle_tool" (
	"circle_id" text,
	"tool_id" text,
	"installed_by" text NOT NULL,
	"scopes" text[] NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circle_tool_pkey" PRIMARY KEY("circle_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "tool_dev_session" (
	"user_id" text PRIMARY KEY,
	"circle_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"url" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_storage" (
	"tool_id" text,
	"circle_id" text,
	"key" text,
	"value" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_storage_pkey" PRIMARY KEY("tool_id","circle_id","key")
);
--> statement-breakpoint
CREATE TABLE "tool_version" (
	"id" text PRIMARY KEY,
	"tool_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tool" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_code" (
	"id" text PRIMARY KEY,
	"device_code" text NOT NULL,
	"user_code" text NOT NULL,
	"user_id" text,
	"expires_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"last_polled_at" timestamp,
	"polling_interval" integer,
	"client_id" text,
	"scope" text
);
--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "tool_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_version_tool_version_uidx" ON "tool_version" ("tool_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCode_deviceCode_uidx" ON "device_code" ("device_code");--> statement-breakpoint
CREATE UNIQUE INDEX "deviceCode_userCode_uidx" ON "device_code" ("user_code");--> statement-breakpoint
ALTER TABLE "circle_tool" ADD CONSTRAINT "circle_tool_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "circle_tool" ADD CONSTRAINT "circle_tool_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "circle_tool" ADD CONSTRAINT "circle_tool_installed_by_user_id_fkey" FOREIGN KEY ("installed_by") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "tool_dev_session" ADD CONSTRAINT "tool_dev_session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "tool_dev_session" ADD CONSTRAINT "tool_dev_session_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "tool_dev_session" ADD CONSTRAINT "tool_dev_session_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "tool_storage" ADD CONSTRAINT "tool_storage_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "tool_storage" ADD CONSTRAINT "tool_storage_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");--> statement-breakpoint
ALTER TABLE "tool_version" ADD CONSTRAINT "tool_version_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "tool" ADD CONSTRAINT "tool_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id");