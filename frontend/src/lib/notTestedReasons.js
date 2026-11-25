// Preset explanations for a test that was not performed.
// The same test-level remarks field accepts a freely typed explanation.
export const NOT_TESTED_REASONS = [
  "Sample rejected",
  "Sample leaked",
  "Insufficient sample",
  "Not tested as per algorithm",
  "Sample collected outside prescribed range",
];

export const isNotTested = (value) =>
  String(value || "").trim().toLowerCase() === "not tested";
