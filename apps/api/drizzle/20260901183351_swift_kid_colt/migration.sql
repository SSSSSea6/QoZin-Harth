CREATE TABLE "comment" (
	"id" text PRIMARY KEY,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "comment_post_created_idx" ON "comment" ("post_id","created_at");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_post_id_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id");--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id");