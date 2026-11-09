/**
 * S21: Nintendo CDN domains worth accelerating (SwitchBrew "Network" page).
 * Only content-delivery hosts are listed — auth (dauth/aauth), shop API and
 * matchmaking domains must never be rewritten, or login/online play breaks.
 */
export interface AccelDomainInfo {
  domain: string;
  label: string;
}

/** lp1 = production environment (SwitchBrew `{server}.hac.{env}.{set}.{host}`). */
export const DEFAULT_ACCEL_DOMAINS: AccelDomainInfo[] = [
  {
    domain: "atum.hac.lp1.d4c.nintendo.net",
    label: "eShop 游戏/更新下载",
  },
  {
    domain: "atumn.hac.lp1.d4c.nintendo.net",
    label: "系统更新下载",
  },
];

export function labelForDomain(domain: string): string {
  return DEFAULT_ACCEL_DOMAINS.find((d) => d.domain === domain)?.label ?? "Nintendo CDN";
}

/** Exact-match against the active accelerate list (v1: no wildcards). */
export function isAcceleratedDomain(name: string, domains: string[]): boolean {
  const lower = name.toLowerCase().replace(/\.$/, "");
  return domains.includes(lower);
}
