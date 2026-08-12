CREATE INDEX "rateLimit_order_track_code_cleanup_idx"
ON "rateLimit" ("lastRequest", "id")
WHERE "id" LIKE 'order-track-code:%';
