import { type Ingestor, parseDomainLines, pollTextList } from "./types.ts";

/**
 * CERT Polska warning list: bare domains, all sites (~126k), refreshed every few minutes
 * upstream. Tier B, disabled by default, and eval-only until CERT Polska confirms reuse.
 */
export const CERT_PL_URL = "https://hole.cert.pl/domains/v2/domains.txt";

export const certPl: Ingestor = {
  id: "cert_pl",
  minIntervalMs: 6 * 60 * 60_000,
  poll: (fetchFn, state) => pollTextList(fetchFn, CERT_PL_URL, state, parseDomainLines),
};
