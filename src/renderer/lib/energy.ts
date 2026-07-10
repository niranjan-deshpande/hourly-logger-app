import type { DayEnergy } from '@shared/types';

// The five day-energy presets, modeling a 2-axis affect grid (activation ×
// pleasantness) as one-tap choices. Colors stay within the app's muted
// earth-tone palette so the texture reads calm, not alarming.
export interface EnergyPreset {
  key: DayEnergy;
  label: string;
  color: string;
  energy: number; // activation, -1..1
  valence: number; // pleasantness, -1..1
  hint: string;
}

export const ENERGY_PRESETS: EnergyPreset[] = [
  { key: 'flow', label: 'Flow', color: '#4E7A4E', energy: 1, valence: 1, hint: 'Energized and engaged' },
  { key: 'calm', label: 'Calm', color: '#4E6E8A', energy: -1, valence: 1, hint: 'Low-key and content' },
  { key: 'fine', label: 'Fine', color: '#8C7E64', energy: 0, valence: 0, hint: 'Neutral — nothing notable' },
  { key: 'drained', label: 'Drained', color: '#5E6A72', energy: -1, valence: -1, hint: 'Depleted, flat' },
  { key: 'stressed', label: 'Stressed', color: '#B0512F', energy: 1, valence: -1, hint: 'Wired, under pressure' },
];

const BY_KEY = new Map(ENERGY_PRESETS.map((p) => [p.key, p]));

export function energyPreset(key: DayEnergy | null | undefined): EnergyPreset | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function energyColor(key: DayEnergy | null | undefined): string | null {
  return energyPreset(key)?.color ?? null;
}

export function energyLabel(key: DayEnergy | null | undefined): string | null {
  return energyPreset(key)?.label ?? null;
}
