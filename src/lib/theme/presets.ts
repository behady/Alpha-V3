import type { ThemeTokens } from "./tokens";

/**
 * The themes a clinic can choose from.
 *
 * Each is a complete set — every role token, every time. Partial presets would leave the previous
 * clinic's values sitting on <html> with nothing to clear them, so completeness is a correctness
 * property here rather than tidiness.
 *
 * Contrast was measured rather than eyeballed; the ink-faint values in inkpaper, damson and
 * sandstone are the corrected ones from that audit, not the first drafts.
 */
export interface ThemePreset {
  id: string;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  /** Shown in the picker: page, surface, accent, ink. */
  swatch: [string, string, string, string];
  tokens: ThemeTokens;
  /**
   * A preset only appears in the picker when this is true.
   *
   * `graphite` is written and correct but withheld: it inverts the surfaces, and ~923 `bg-white`
   * usages are not yet on `bg-surface`, so a dark theme would paint a dark page and leave a field
   * of white cards on it. It ships when that migration finishes — keeping the record here is what
   * makes that finish line testable.
   */
  available: boolean;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "mint",
    nameEn: "Mint & Slate",
    nameAr: "نعناع وأردواز",
    descEn: "The current look. Nothing changes.",
    descAr: "المظهر الحالي. لا يتغير شيء.",
    swatch: ["#E8F0ED", "#FFFFFF", "#1D7F46", "#0F172A"],
    available: true,
    // Byte-identical to the :root block in globals.css. This preset's entire contract is that an
    // existing clinic does not wake up to a repainted product, so it must not be "improved".
    tokens: {
      "surface-page": "#E8F0ED", "surface": "#FFFFFF", "surface-subtle": "#F8FAFC",
      "surface-muted": "#F1F5F9", "surface-accent": "#E8F7F0",
      "line": "#E2E8F0", "line-strong": "#CBD5E1",
      "ink": "#0F172A", "ink-slab": "#1A2130", "ink-strong": "#2D3748",
      "ink-body": "#475569", "ink-muted": "#64748B", "ink-faint": "#78899F",
      "ink-on-accent": "#FFFFFF",
      "accent": "#1D7F46", "accent-soft": "#60D297", "accent-strong": "#046B4C",
      "accent-tint": "#E8F7F0",
      "ok": "#05603A", "ok-tint": "#ECFDF5", "warn": "#C44A0A", "warn-tint": "#FFF7ED",
      "danger": "#C51F1F", "danger-tint": "#FEF2F2", "info": "#1D4FD8", "info-tint": "#EFF6FF",
    },
  },
  {
    id: "inkpaper",
    nameEn: "Ink on Paper",
    nameAr: "حبر على ورق",
    descEn: "Warm paper and near-black ink. Colour kept for warnings only.",
    descAr: "ورق دافئ وحبر شبه أسود. الألوان للتنبيهات فقط.",
    swatch: ["#F2EFE9", "#FFFFFF", "#23211C", "#14130F"],
    available: true,
    tokens: {
      "surface-page": "#F2EFE9", "surface": "#FFFFFF", "surface-subtle": "#FAF8F4",
      "surface-muted": "#F0ECE4", "surface-accent": "#EAE5DC",
      "line": "#E3DED4", "line-strong": "#CFC8BB",
      "ink": "#14130F", "ink-slab": "#1C1A16", "ink-strong": "#33302A",
      "ink-body": "#4E4A42", "ink-muted": "#6C6659", "ink-faint": "#8E8579",
      "ink-on-accent": "#FAF8F3",
      "accent": "#23211C", "accent-soft": "#555047", "accent-strong": "#0B0A08",
      "accent-tint": "#ECE8E0",
      "ok": "#2F6B4C", "ok-tint": "#E9F2EC", "warn": "#A05A15", "warn-tint": "#F7EFE2",
      "danger": "#A32A22", "danger-tint": "#F7E9E7", "info": "#2C5A96", "info-tint": "#E8EEF7",
    },
  },
  {
    id: "damson",
    nameEn: "Damson",
    nameAr: "برقوق داكن",
    descEn: "Cool porcelain with one bruised plum. Quiet behind clinical photography.",
    descAr: "بورسلين بارد مع لمسة برقوق. هادئ خلف الصور الطبية.",
    swatch: ["#F1F0F4", "#FFFFFF", "#7B3F6B", "#17131F"],
    available: true,
    tokens: {
      "surface-page": "#F1F0F4", "surface": "#FFFFFF", "surface-subtle": "#F8F7FA",
      "surface-muted": "#EDEBF1", "surface-accent": "#F3EBF2",
      "line": "#E4E1EA", "line-strong": "#CBC6D4",
      "ink": "#17131F", "ink-slab": "#221C2C", "ink-strong": "#332C40",
      "ink-body": "#4E4759", "ink-muted": "#675F79", "ink-faint": "#8B829A",
      "ink-on-accent": "#FFFFFF",
      "accent": "#7B3F6B", "accent-soft": "#A97399", "accent-strong": "#5C2B4F",
      "accent-tint": "#F4EAF1",
      "ok": "#12704F", "ok-tint": "#E7F4EF", "warn": "#A34B08", "warn-tint": "#FBF1E6",
      "danger": "#B92D2D", "danger-tint": "#FAEBEA", "info": "#2E5FA8", "info-tint": "#E9EFF9",
    },
  },
  {
    id: "sandstone",
    nameEn: "Sandstone & Petrol",
    nameAr: "حجر رملي وبترولي",
    descEn: "Warm limestone cut by a deep petrol teal.",
    descAr: "حجر جيري دافئ مع أزرق بترولي عميق.",
    swatch: ["#F1EBE1", "#FFFCF8", "#0F6E73", "#1B1A17"],
    available: true,
    tokens: {
      "surface-page": "#F1EBE1", "surface": "#FFFCF8", "surface-subtle": "#F8F4EC",
      "surface-muted": "#EDE5D8", "surface-accent": "#E2EDEC",
      "line": "#E0D7C8", "line-strong": "#C7BCA9",
      "ink": "#1B1A17", "ink-slab": "#232019", "ink-strong": "#3A362E",
      "ink-body": "#565043", "ink-muted": "#6A6352", "ink-faint": "#8C806C",
      "ink-on-accent": "#FFFFFF",
      "accent": "#0F6E73", "accent-soft": "#4E9CA0", "accent-strong": "#0A5257",
      "accent-tint": "#E3EFEF",
      "ok": "#376F2C", "ok-tint": "#EEF4E7", "warn": "#A5560A", "warn-tint": "#FAF0E3",
      "danger": "#B3302A", "danger-tint": "#F9E9E6", "info": "#2D5AA6", "info-tint": "#E9EEF8",
    },
  },
  {
    id: "graphite",
    nameEn: "Graphite & Bone",
    nameAr: "جرافيت وعاج",
    descEn: "A dark room with one warm accent. Available once white surfaces are migrated.",
    descAr: "غرفة داكنة بلمسة دافئة واحدة. متاح بعد اكتمال تحويل الأسطح البيضاء.",
    swatch: ["#0E1113", "#171B1E", "#D6CEC2", "#F5F3EF"],
    available: false,
    tokens: {
      "surface-page": "#0E1113", "surface": "#171B1E", "surface-subtle": "#1E2327",
      "surface-muted": "#262C31", "surface-accent": "#262521",
      "line": "#2A3035", "line-strong": "#3B434A",
      "ink": "#F5F3EF", "ink-slab": "#07090B", "ink-strong": "#E2E0DA",
      "ink-body": "#C3C7CB", "ink-muted": "#949BA1", "ink-faint": "#6E767D",
      "ink-on-accent": "#14161A",
      "accent": "#D6CEC2", "accent-soft": "#EDE7DD", "accent-strong": "#BEB5A7",
      "accent-tint": "#23231F",
      // warn deepened from #E0A458: it sat 2.5 degrees of hue from the bone accent, so a warning
      // dot beside a brand dot read as two shades of one colour.
      "ok": "#46C08A", "ok-tint": "#12241C", "warn": "#D99038", "warn-tint": "#2A2116",
      "danger": "#F06A63", "danger-tint": "#2E1917", "info": "#7FA9E8", "info-tint": "#16202E",
    },
  },
];

export const DEFAULT_PRESET_ID = "mint";

export function getPreset(id: string | null | undefined): ThemePreset | null {
  if (!id) return null;
  return THEME_PRESETS.find((p) => p.id === id) ?? null;
}

/** What the picker offers. Withheld presets stay in the file but out of the UI. */
export function availablePresets(): ThemePreset[] {
  return THEME_PRESETS.filter((p) => p.available);
}
