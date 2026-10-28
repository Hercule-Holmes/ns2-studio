/**
 * S19: Nintendo playtime (parental controls API) channels.
 * Read-only access to the caller's own Nintendo Account data.
 */
export const NintendoChannels = {
  accounts: "nintendo:accounts",
  accountAdd: "nintendo:accountAdd",
  accountRemove: "nintendo:accountRemove",
  sync: "nintendo:sync",
  data: "nintendo:data",
  cover: "nintendo:cover",
  changed: "nintendo:changed",
  syncProgress: "nintendo:syncProgress",
} as const;
