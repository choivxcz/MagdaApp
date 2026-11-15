// Stop search and the AI server's input checks (no network needed).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareRoute } from '../src/lib/geo.js';
import { matchStops, serviceBox, inBox } from '../src/lib/places.js';
import { findStop } from '../src/lib/assistant/knowledge.js';
import { _readInput, _runTool } from '../api/_agent.js';

const route = prepareRoute(JSON.parse(readFileSync(new URL('../src/data/route-magdalena-santa-cruz.json', import.meta.url), 'utf8')));

describe('stop search', () => {
  it('finds stops by the names people use', () => {
    expect(matchStops(route, 'palengke')[0].stopId).toBe('public-market');
    expect(matchStops(route, 'kapitol')[0].stopId).toBe('capitol');
    expect(matchStops(route, 'dlt')[0].stopId).toBe('dltb');
    expect(findStop(route, 'sta cruz')?.id).toBe('santa-cruz-plaza');
  });

  it('returns nothing for unknown text', () => {
    expect(matchStops(route, 'zzzz')).toEqual([]);
  });

  it('the service area contains the whole route', () => {
    const box = serviceBox(route);
    for (const s of route.stops) expect(inBox(box, s.coord)).toBe(true);
    expect(inBox(box, [121.0, 14.6])).toBe(false); // Manila
  });
});

describe('AI server input', () => {
  const body = (context) => ({ messages: [{ role: 'user', text: 'hi' }], context });

  it('drops map spots outside the service area', () => {
    const { context } = _readInput(body({ mapTrip: { from: { label: 'Manila', point: [121.0, 14.6] }, to: { label: 'Near', point: route.stops[3].coord } } }));
    expect(context.mapTrip.from).toBeNull();
    expect(context.mapTrip.to.point).toEqual(route.stops[3].coord);
  });

  it('keeps only valid, short community tips', () => {
    const { context } = _readInput(body({ tips: [
      { category: 'boarding', body: 'x'.repeat(500), stopId: 'capitol' },
      { category: 'spam', body: 'buy now' },
      { category: 'fare', body: 42 },
    ] }));
    expect(context.tips).toHaveLength(1);
    expect(context.tips[0].body).toHaveLength(280);
    expect(context.tips[0].stop).toBe('Laguna Provincial Capitol');
  });

  it('plans a stop-to-stop journey and puts it on the map without sending coordinates to the model', async () => {
    const ctx = { ..._readInput(body({})).context, actions: [] };
    const result = await _runTool('plan_journey', { from: 'DLTB', to: 'Capitol' }, ctx);
    expect(result.options[0].jeepneys).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/121\.\d{3}/); // no longitude in what Gemini sees
    expect(ctx.actions[0]).toMatchObject({ type: 'show_trip', auto: false });
  });

  it('asks for a start when the rider has none', async () => {
    const ctx = { ..._readInput(body({})).context, actions: [] };
    const result = await _runTool('plan_journey', { from: 'my location', to: 'Capitol' }, ctx);
    expect(result.error).toMatch(/where they will start/);
  });
});
