/**
 * Settings / application config persistence channels.
 *
 * `settings:*` (S2) keeps the lightweight last-port/last-baud memory;
 * `config:*` (S11) is the full AppConfig (03-DATA-MODELS §6) at
 * `userData/config.json`.
 */
export const SettingsChannels = {
  get: "settings:get",
  update: "settings:update",
} as const;

export const ConfigChannels = {
  get: "config:get",
  update: "config:update",
} as const;

export const AppInfoChannels = {
  get: "app:getInfo",
} as const;