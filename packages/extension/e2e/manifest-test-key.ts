/**
 * Test-only manifest signing key for the e2e suite: the fake feed server signs with the
 * private half, and only `wxt build --mode e2e` trusts the public half (background.ts).
 * Never used by a production build or the real feed service.
 */
export const E2E_MANIFEST_KID = "e2e";
export const E2E_MANIFEST_PUBLIC_KEY = "PlZTpN10SSamvjlJt9F0LfB6vprjyyezr6xizXXT3LA=";
export const E2E_MANIFEST_PRIVATE_KEY =
  "MC4CAQAwBQYDK2VwBCIEIIw3xjUC+ZUFKAYz/++vV4BXyDeT5T7iXyZI7Q07laeh";
