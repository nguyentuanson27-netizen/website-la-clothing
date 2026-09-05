import type { MerchantFeedCoordinatorResult } from "./merchant-feed-coordinator.ts";

export function createMerchantFeedGetHandler(
  getFeed: () => Promise<MerchantFeedCoordinatorResult>,
) {
  return async function GET(_request: Request): Promise<Response> {
    const result = await getFeed();
    if (!result.ok) {
      return new Response("Merchant feed temporarily unavailable.\n", {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "retry-after": String(result.retryAfterSeconds),
          "x-la-merchant-feed-failure": result.failureClass,
        },
      });
    }

    return new Response(result.body, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/rss+xml; charset=utf-8",
        "x-la-merchant-feed-state": result.cache,
      },
    });
  };
}
