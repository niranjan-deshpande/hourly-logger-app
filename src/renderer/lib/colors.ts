export interface PaletteColor {
  name: string;
  hex: string;
}

// Earth-tones with more chroma than the original muted set, spread around
// the hue wheel so adjacent categories never look like the same color.
// They still read as warm/restrained against the cream background, but each
// is clearly distinct on its own and from the others.
export const PALETTE: PaletteColor[] = [
  { name: 'Terracotta', hex: '#B0512F' },
  { name: 'Clay', hex: '#C97A3F' },
  { name: 'Ochre', hex: '#C39424' },
  { name: 'Moss', hex: '#6F8A36' },
  { name: 'Sage', hex: '#4E7A4E' },
  { name: 'Fern', hex: '#2F5E3F' },
  { name: 'Teal', hex: '#3E7373' },
  { name: 'Slate', hex: '#3F6478' },
  { name: 'Indigo', hex: '#3F507F' },
  { name: 'Plum', hex: '#6F3F77' },
  { name: 'Dusk', hex: '#534A77' },
  { name: 'Mushroom', hex: '#7F6A54' },
];

export function isValidHex(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s);
}

// Suggest the next palette color in sequence the user hasn't picked yet.
export function nextColor(used: string[]): string {
  const usedLower = new Set(used.map((c) => c.toLowerCase()));
  const fresh = PALETTE.find((c) => !usedLower.has(c.hex.toLowerCase()));
  return (fresh ?? PALETTE[0]).hex;
}

// Generate an alpha-tinted background from a hex + 0..1 alpha.
export function withAlpha(hex: string, alpha: number): string {
  if (!isValidHex(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
