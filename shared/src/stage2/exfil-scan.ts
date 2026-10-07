/**
 * Stage 2 credential-exfiltration scan (S2.7, part 1 of 2): where a login page sends what
 * the user types. Modern kits post credentials to a Telegram bot, a Discord webhook, or a
 * form-to-email service from inline JavaScript; ordinary sites don't. Also collects the
 * hosts that login forms post to, for the cross-site check in exfil-signal.ts (which needs
 * the PSL, so it runs in the background, not in the content script).
 *
 * Only the endpoint kind leaves this module; never the URL, bot token, or webhook id.
 */
import type { FieldInfo, FormInfo } from "../page/extract.ts";

export type ExfilEndpoint = "telegram" | "discord" | "formService";

export interface ExfilInput {
  forms: readonly FormInfo[];
  /** External script URLs. */
  scriptSrcs: readonly string[];
  /** Inline script text, concatenated. */
  inlineScript: string;
}

export interface ExfilScan {
  endpoint: ExfilEndpoint | null;
  /** The page looks up the visitor's IP (kits log victims). Supporting only. */
  ip: boolean;
  /** Hosts that login forms post to (absolute http(s) actions only), deduplicated. */
  formHosts: string[];
}

/** Inline script text beyond this is not scanned. */
export const MAX_INLINE_SCRIPT = 200_000;
const MAX_FORM_HOSTS = 10;

const ENDPOINTS: [ExfilEndpoint, RegExp][] = [
  ["telegram", /api\.telegram\.org\/bot/i],
  ["discord", /discord(?:app)?\.com\/api\/webhooks\//i],
  [
    "formService",
    /formsubmit\.co|submit-form\.com|formspree\.io|getform\.io|usebasin\.com|formcarry\.com|web3forms\.com|staticforms\.xyz/i,
  ],
];
const IP_LOOKUP = /ipapi\.co|ipinfo\.io|api\.ipify\.org|ip-api\.com|geoplugin\.net|ipwho\.is/i;

const LOGIN_HINT = /user|login|e-?mail|account|phone/i;

/** A field someone types a credential or account identifier into. */
function credentialField(f: FieldInfo): boolean {
  if (!f.visible) return false;
  if (f.secret) return true;
  if (f.type === "email" || f.type === "tel") return true;
  if (["username", "email", "tel"].includes(f.autocomplete)) return true;
  return f.type === "text" && LOGIN_HINT.test(`${f.name} ${f.id} ${f.label} ${f.placeholder}`);
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

function endpointIn(text: string): ExfilEndpoint | null {
  for (const [kind, re] of ENDPOINTS) if (re.test(text)) return kind;
  return null;
}

export function scanExfil(input: ExfilInput): ExfilScan {
  const code = `${input.inlineScript.slice(0, MAX_INLINE_SCRIPT)}\n${input.scriptSrcs.join("\n")}`;
  const loginForms = input.forms.filter((f) => !f.loose && f.fields.some(credentialField));
  const formHosts = [
    ...new Set(loginForms.map((f) => hostOf(f.action)).filter((h): h is string => !!h)),
  ].slice(0, MAX_FORM_HOSTS);
  const formEndpoint = endpointIn(loginForms.map((f) => f.action).join("\n"));
  return {
    endpoint: endpointIn(code) ?? formEndpoint,
    ip: IP_LOOKUP.test(code),
    formHosts,
  };
}
