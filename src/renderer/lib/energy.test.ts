import { describe, it, expect } from 'vitest';
import { ENERGY_PRESETS, energyColor, energyLabel, energyPreset } from './energy';
import { overlapMsWithin, startOfWeek, weekDays } from './time';

describe('energy presets', () => {
  it('exposes the five presets', () => {
    expect(ENERGY_PRESETS.map((p) => p.key)).toEqual([
      'flow',
      'calm',
      'fine',
      'drained',
      'stressed',
    ]);
  });

  it('looks up a preset by key', () => {
    expect(energyPreset('flow')?.label).toBe('Flow');
    expect(energyColor('stressed')).toBe('#B0512F');
    expect(energyLabel('calm')).toBe('Calm');
  });

  it('returns null for no/unknown energy', () => {
    expect(energyPreset(null)).toBeNull();
    expect(energyPreset(undefined)).toBeNull();
    expect(energyColor(null)).toBeNull();
  });
});

describe('week date helpers', () => {
  it('startOfWeek returns the Monday of the containing week', () => {
    // 2020-01-08 is a Wednesday; its Monday is 2020-01-06.
    const wed = new Date(2020, 0, 8, 15, 0, 0);
    const mon = startOfWeek(wed);
    expect(mon.getFullYear()).toBe(2020);
    expect(mon.getMonth()).toBe(0);
    expect(mon.getDate()).toBe(6);
    expect(mon.getDay()).toBe(1); // Monday
    expect(mon.getHours()).toBe(0);
  });

  it('startOfWeek treats Sunday as the end of its week', () => {
    // 2020-01-12 is a Sunday; its Monday is 2020-01-06.
    const sun = new Date(2020, 0, 12, 9, 0, 0);
    expect(startOfWeek(sun).getDate()).toBe(6);
  });

  it('weekDays returns 7 days Monday..Sunday', () => {
    const days = weekDays(new Date(2020, 0, 8));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(1); // Mon
    expect(days[6].getDay()).toBe(0); // Sun
    expect(days[6].getDate()).toBe(12);
  });
});

describe('overlapMsWithin — week-column block assignment', () => {
  // The day window: 2020-01-06 (Mon) local, [00:00, next 00:00).
  const dayStart = new Date(2020, 0, 6, 0, 0, 0).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const iso = (h: number, m = 0, dayOffset = 0) =>
    new Date(2020, 0, 6 + dayOffset, h, m, 0).toISOString();
  const HOUR = 3600000;

  it('counts a block fully within the day', () => {
    expect(overlapMsWithin(iso(9), iso(11), dayStart, dayEnd)).toBe(2 * HOUR);
  });

  it('clips a block that ends after midnight to the part within the day', () => {
    // 11pm Mon → 1am Tue: only the 1h before midnight is in Monday.
    expect(overlapMsWithin(iso(23), iso(1, 0, 1), dayStart, dayEnd)).toBe(HOUR);
  });

  it('keeps the morning sliver of a block that started the previous night', () => {
    // 11:30pm Sun → 12:45am Mon: 45m falls inside Monday (was dropped before).
    const v = overlapMsWithin(iso(23, 30, -1), iso(0, 45), dayStart, dayEnd);
    expect(v).toBe(45 * 60 * 1000);
  });

  it('returns 0 for a block entirely outside the day', () => {
    expect(overlapMsWithin(iso(9, 0, 2), iso(10, 0, 2), dayStart, dayEnd)).toBe(0);
  });
});
