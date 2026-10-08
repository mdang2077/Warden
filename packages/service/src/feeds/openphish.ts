import { type Ingestor, pollTextList } from "./types.ts";

/** OpenPhish community feed: refreshed every 12 h upstream, polled at most hourly. */
export const OPENPHISH_URL =
  "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt";

export const openphish: Ingestor = {
  id: "openphish",
  minIntervalMs: 60 * 60_000,
  poll: (fetchFn, state) => pollTextList(fetchFn, OPENPHISH_URL, state),
};
