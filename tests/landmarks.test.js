// Landmarks along the route: the saved data, search, and "by Jollibee" hints.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareRoute } from '../src/lib/geo.js';
import { makeLandmarks, LANDMARK_CATS, offRoute } from '../src/lib/landmarks.js';
import { spotText } from '../src/lib/planner.js';
import { _runTool, _readInput } from '../api/_agent.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const route = prepareRoute(read('../src/data/route-magdalena-santa-cruz.json'));
const data = read('../src/data/landmarks.json');
const lm = makeLandmarks(data, route);

describe('landmark data', () => {
  it('has the iconic places of Magdalena and Santa Cruz', () => {
    const iconic = lm.list.filter((l) => l.rank === 0).map((l) => l.name);
    for (const name of [/Maulawin/, /Mary Magdalene/, /Provincial Capitol/, /Santa Cruz Public Market/, /DLTB/, /Magdalena Municipal Hall/]) {
      expect(iconic.some((n) => name.test(n))).toBe(true);
    }
  });

  it('every landmark is named, known, and close to the route', () => {
    expect(lm.list.length).toBeGreaterThan(100);
    for (const l of lm.list) {
      expect(l.name.length).toBeGreaterThanOrEqual(3);
      expect(l.name).not.toMatch(/^\d+$|name not visible/i);
      expect(LANDMARK_CATS[l.cat]).toBeTruthy();
      expect(offRoute(route, l.coord)).toBeLessThanOrEqual(360);
    }
  });

  it('has no duplicate ids', () => {
    expect(new Set(lm.list.map((l) => l.id)).size).toBe(lm.list.length);
  });
});

describe('landmark search and hints', () => {
  it('finds landmarks by part of the name', () => {
    expect(lm.match('cathedral')[0].label).toMatch(/Maulawin/);
    expect(lm.match('mang inasal')[0].label).toBe('Mang Inasal');
    expect(lm.match('jolli').every((p) => p.kind === 'landmark')).toBe(true);
    expect(lm.match('x')).toEqual([]);
  });

  it('describes a spot with a landmark next to it', () => {
    const jollibee = lm.list.find((l) => /jollibee/i.test(l.name));
    expect(lm.near(jollibee.coord)?.name).toBeTruthy();
    expect(spotText(null, jollibee.coord, (p) => lm.near(p))).toMatch(/^by /);
    expect(spotText(null, [121.0, 14.6], (p) => lm.near(p))).toBe('along the route');
  });

  it('does not repeat the stop as its own landmark', () => {
    const dltb = route.stops.find((s) => s.id === 'dltb');
    const text = spotText({ stop: dltb }, dltb.coord, () => ({ name: 'DLTBCo. Santa Cruz Terminal' }));
    expect(text).toBe(`near ${dltb.short ?? dltb.name}`);
  });
});

describe('AI uses landmarks', () => {
  it('plans to a landmark without searching online', async () => {
    const ctx = { ..._readInput({ messages: [{ role: 'user', text: 'hi' }], context: {} }).context, actions: [] };
    const r = await _runTool('plan_journey', { from: 'Magdalena', to: 'cathedral' }, ctx);
    expect(r.to).toMatch(/Maulawin/);
    expect(r.options[0].jeepneys).toBe(1);
    expect(ctx.actions[0].to.label).toMatch(/Maulawin/);
  });
});
