import { promises as dns } from 'node:dns';
import { checkWebhookUrl, isPrivateIp } from '@ecolemanager/shared';

/**
 * Outbound-call guard (SSRF): static URL check, then every address the host resolves to must be public.
 * Returns a refusal reason, or null when the target may be called. Callers must also use `redirect: 'manual'`,
 * otherwise a public host could redirect the request (and its credentials) to an internal address.
 */
export async function refuseTarget(url: string, allowPrivate = false, lookup: typeof dns.lookup = dns.lookup): Promise<string | null> {
  const bad = checkWebhookUrl(url, allowPrivate);
  if (bad) return bad;
  if (allowPrivate) return null;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return 'host does not resolve';
    if (addrs.some((a) => isPrivateIp(a.address))) return 'target resolves to a private address';
  } catch { return 'host does not resolve'; }
  return null;
}
