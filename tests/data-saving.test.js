// Data saving: only-what-changed jeepney updates must never lose or keep
// the wrong jeepneys, and Data saver must follow the phone's own setting.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({ supabase: null, isDemo: true }));
const { mergeUpdate } = await import('../src/lib/useJeepneys.js');
const { isDataSaver } = await import('../src/lib/prefs.js');

const NOW = Date.parse('2026-11-18T08:00:00Z');
const jeep = (id, secondsAgo, extra = {}) => ({ id, plate: id, active: true, updatedAt: new Date(NOW - secondsAgo * 1000), ...extra });

describe('jeepney updates (only what changed)', () => {
  it('a full answer replaces everything', () => {
    const known = new Map([['old', jeep('old', 5)]]);
    const next = mergeUpdate(known, { now: NOW, full: true, rows: [jeep('A', 3)] });
    expect([...next.keys()]).toEqual(['A']);
  });

  it('a small answer updates changed jeepneys and keeps the rest', () => {
    const known = new Map([['A', jeep('A', 20, { lat: 1 })], ['B', jeep('B', 15)]]);
    const next = mergeUpdate(known, { now: NOW, full: false, rows: [jeep('A', 1, { lat: 2 })] });
    expect(next.get('A').lat).toBe(2);
    expect(next.has('B')).toBe(true);
    expect(known.get('A').lat).toBe(1); // the old map isn't changed
  });

  it('removes a jeepney whose trip ended', () => {
    const known = new Map([['A', jeep('A', 20)]]);
    expect(mergeUpdate(known, { now: NOW, full: false, rows: [jeep('A', 1, { active: false })] }).has('A')).toBe(false);
  });

  it('drops jeepneys silent for more than 2 minutes', () => {
    const known = new Map([['quiet', jeep('quiet', 125)], ['fresh', jeep('fresh', 30)]]);
    const next = mergeUpdate(known, { now: NOW, full: false, rows: [] });
    expect([...next.keys()]).toEqual(['fresh']);
  });
});

describe('Data saver', () => {
  it('on / off / auto follows the phone', () => {
    expect(isDataSaver({ dataSaver: 'on' })).toBe(true);
    expect(isDataSaver({ dataSaver: 'off' })).toBe(false);
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    expect(isDataSaver({ dataSaver: 'auto' })).toBe(true);
    vi.stubGlobal('navigator', { connection: { saveData: false, effectiveType: '4g' } });
    expect(isDataSaver({ dataSaver: 'auto' })).toBe(false);
    vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } });
    expect(isDataSaver({ dataSaver: 'auto' })).toBe(true);
    vi.unstubAllGlobals();
  });
});
