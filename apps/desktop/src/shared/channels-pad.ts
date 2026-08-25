/**
 * Virtual pad report submission channels (S3). The renderer never talks to
 * the serial port; it hands PadReports to the InputHub manual source.
 */
export const PadChannels = {
  apply: "pad:apply",
  reset: "pad:reset",
} as const;