// ─── Design System ────────────────────────────────────────────────────────────
// Momentum brand palette — black/charcoal background, neon lime green (#C6FF00),
// bold white text. Matches the official Momentum brand guide.

export const COLORS = {
  // Backgrounds
  background: "#000000",      // Pure black — main screen bg
  surface: "#111111",         // Charcoal — elevated surface
  card: "#1E1E1E",            // Dark gray — card bg
  cardSurface: "#1E1E1E",     // Dark gray — card inner surface
  cardBorder: "#2A2A2A",      // Gray — card/section borders
  input: "#1E1E1E",           // Dark gray — text input bg
  inputBorder: "#2A2A2A",     // Gray — input border

  // Nav
  navBg: "#111111",           // Charcoal — tab bar background

  // Accent (Momentum Green — official brand color)
  accent: "#C6FF00",
  accentDark: "#9FCC00",
  accentFaint: "rgba(198,255,0,0.12)",

  // Accent 2 (player B — electric blue)
  accent2: "#4FC3F7",
  accent2Faint: "rgba(79,195,247,0.12)",

  // Text
  textPrimary: "#FFFFFF",
  textSecondary: "#A0A0A0",   // Light gray — secondary copy
  textMuted: "#666666",       // Mid gray — muted/placeholder
  textHandle: "#808080",      // Mid gray — @handle

  // Status
  error: "#FF4444",
  errorFaint: "rgba(255,68,68,0.12)",
  live: "#FF4444",
  liveFaint: "rgba(255,68,68,0.12)",

  // Overlay
  overlay: "rgba(0,0,0,0.80)",
  overlayLight: "rgba(0,0,0,0.50)",

  // Misc
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

export const FONTS = {
  thin: "100" as const,
  light: "300" as const,
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
  extrabold: "800" as const,
  heavy: "900" as const,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const RADIUS = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const ATHLETE_TYPES = [
  "Basketball",
  "Football",
  "Soccer",
  "Track & Field",
  "Baseball",
  "Wrestling",
  "Tennis",
  "Swimming",
  "Volleyball",
  "Gymnastics",
  "Other",
] as const;

export const BATTLE_CATEGORIES = [
  "Highlights",
  "Drills",
  "Game Clips",
  "Training",
  "Free Style",
] as const;

export const BATTLE_DURATIONS: { label: string; hours: number }[] = [
  { label: "24 Hours", hours: 24 },
  { label: "48 Hours", hours: 48 },
  { label: "7 Days", hours: 168 },
];
