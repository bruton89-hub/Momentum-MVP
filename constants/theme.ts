// ─── Design System ────────────────────────────────────────────────────────────
// Momentum brand palette — black/charcoal background, neon lime green (#C6FF00),
// bold white text. Matches the official Momentum brand guide.

export const COLORS = {
  // Backgrounds
  background: "#000000",      // Pure black — main screen bg
  surface: "#111111",         // Charcoal — elevated surface
  surfaceDeep: "#0A0A0A",     // Near-black — video wells / media placeholders
  surfaceRaised: "#131313",   // Slightly raised — featured cards
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
  accentSoft: "rgba(198,255,0,0.18)",   // vote hints, soft fills
  accentBorderFaint: "rgba(198,255,0,0.25)", // featured card borders

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
  warning: "#FFC400",
  warningFaint: "rgba(255,196,0,0.10)",
  warningBorder: "rgba(255,196,0,0.45)",

  // Overlay / scrims (over media)
  overlay: "rgba(0,0,0,0.80)",
  overlayLight: "rgba(0,0,0,0.50)",
  scrim: "rgba(0,0,0,0.55)",       // voted overlays, tap-to-change
  scrimBadge: "rgba(0,0,0,0.70)",  // duration/music badges over media
  scrimHeavy: "rgba(0,0,0,0.78)",  // winner banners over media

  // Misc
  white: "#FFFFFF",
  black: "#000000",
  transparent: "transparent",
} as const;

// ─── Typography scale ─────────────────────────────────────────────────────────
// Single source of truth for font sizes + line heights. Use with FONTS weights:
//   { fontSize: TYPE.body, lineHeight: LINE.body }
export const TYPE = {
  micro: 10,     // badges, tab labels
  caption: 11,   // metadata, pills, counts
  small: 12,     // handles, secondary metadata
  footnote: 13,  // captions, chips, hints
  body: 14,      // list text, tabs
  base: 15,      // inputs, primary list rows
  callout: 16,   // emphasized rows, section titles
  headline: 18,  // modal/bar titles
  title3: 20,    // sheet titles
  title2: 22,    // screen headings, stat values
  title1: 24,    // profile names, welcome titles
  hero: 28,      // auth headings
  display: 34,   // brand logo lockup
} as const;

export const LINE = {
  micro: 14,
  caption: 15,
  small: 17,
  footnote: 19,
  body: 20,
  base: 21,
  callout: 22,
  headline: 24,
  title3: 26,
  title2: 28,
  title1: 30,
  hero: 34,
  display: 40,
} as const;

// ─── Shared interaction constants ─────────────────────────────────────────────
/** Standard hitSlop for small tap targets (brings them to ~44pt minimum). */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Neon glow for primary CTAs — subtle on iOS, elevation fallback on Android. */
export const GLOW = {
  accent: {
    shadowColor: "#C6FF00",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/**
 * Gradient scrims for full-screen media — keep overlay text readable without
 * dimming the whole highlight. Use with expo-linear-gradient.
 * - top: behind the brand row + discovery tabs
 * - bottom: lower ~30% of the card, behind identity + caption
 * - rail: subtle horizontal fade behind the right interaction rail
 * The center of the video stays untouched so the athletic action reads bright.
 */
export const SCRIMS: { top: string[]; bottom: string[]; rail: string[] } = {
  top: ["rgba(0,0,0,0.62)", "rgba(0,0,0,0.26)", "rgba(0,0,0,0)"],
  bottom: [
    "rgba(0,0,0,0)",
    "rgba(0,0,0,0.30)",
    "rgba(0,0,0,0.62)",
    "rgba(0,0,0,0.92)",
  ],
  rail: ["rgba(0,0,0,0)", "rgba(0,0,0,0.28)"],
};

/**
 * Profile banner fallbacks — one gradient per sport, used until an athlete
 * uploads their own banner. Every profile gets a deliberate look on day one
 * instead of an empty bar, and the sport is legible at a glance.
 *
 * Each ramp ends near-black so the avatar, name, and badges that sit over the
 * lower half of the banner keep their contrast without an extra scrim.
 */
export const SPORT_BANNERS: Record<string, readonly [string, string, string]> = {
  Basketball: ["#7A3B00", "#331700", "#0A0A0A"],
  Football: ["#0B4F2A", "#082B18", "#0A0A0A"],
  Soccer: ["#053B52", "#04222E", "#0A0A0A"],
  "Track & Field": ["#5B1E5B", "#2C0F2C", "#0A0A0A"],
  Baseball: ["#123A6B", "#0A2140", "#0A0A0A"],
  Wrestling: ["#6B1414", "#3A0B0B", "#0A0A0A"],
  Tennis: ["#4C5F00", "#2A3500", "#0A0A0A"],
  Swimming: ["#00495C", "#002932", "#0A0A0A"],
  Volleyball: ["#7A4A00", "#3D2500", "#0A0A0A"],
  Gymnastics: ["#4A1D63", "#291036", "#0A0A0A"],
  Other: ["#242424", "#141414", "#0A0A0A"],
};

/** Gradient for an athlete's sport, falling back to the neutral ramp. */
export function bannerGradientForSport(
  sport?: string | null
): readonly [string, string, string] {
  if (!sport) return SPORT_BANNERS.Other;
  return SPORT_BANNERS[sport] ?? SPORT_BANNERS.Other;
}

/** Scrim laid over an uploaded banner so overlaid text stays readable. */
export const BANNER_SCRIM: string[] = [
  "rgba(0,0,0,0.10)",
  "rgba(0,0,0,0.45)",
  "rgba(0,0,0,0.88)",
];

/** Likes needed before a post earns the 🔥 Trending badge. */
export const TRENDING_LIKES_THRESHOLD = 25;

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
