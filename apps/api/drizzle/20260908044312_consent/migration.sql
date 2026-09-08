CREATE TABLE "tool_consent" (
	"user_id" text,
	"tool_id" text,
	"circle_id" text,
	"scopes" text[] NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "tool_consent_pkey" PRIMARY KEY("user_id","tool_id","circle_id")
);
--> statement-breakpoint
CREATE INDEX "tool_consent_tool_circle_idx" ON "tool_consent" ("tool_id","circle_id");--> statement-breakpoint
ALTER TABLE "tool_consent" ADD CONSTRAINT "tool_consent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "tool_consent" ADD CONSTRAINT "tool_consent_tool_id_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "tool"("id");--> statement-breakpoint
ALTER TABLE "tool_consent" ADD CONSTRAINT "tool_consent_circle_id_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circle"("id");