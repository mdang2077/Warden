import { type Ingestor, pollTextList } from "./types.ts";

/**
 * Phishing.Database ACTIVE links (URLs only; the domains file is never used for blocking).
 * Tier B and disabled by default: large aggregator with a history of FPs.
 */
export const PHISHING_DATABASE_URL =
  "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-ACTIVE.txt";

export const phishingDatabase: Ingestor = {
  id: "phishing_database",
  minIntervalMs: 6 * 60 * 60_000,
  poll: (fetchFn, state) => pollTextList(fetchFn, PHISHING_DATABASE_URL, state),
};
