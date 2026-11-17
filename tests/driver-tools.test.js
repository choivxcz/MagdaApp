// Driver tools: trip status as riders and the AI see it, voice phrases,
// earnings math.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareRoute, pointAlong } from '../src/lib/geo.js';
import { inService, riderStatusText, markerTag, STATUS_KEYS } from '../src/lib/tripStatus.js';
import { jeepsComingTo, describeJeepneys } from '../src/lib/assistant/knowledge.js';
import { PHRASES } from '../src/lib/driverTools.js';
import { net } from '../src/lib/driverData.js';
import { _readInput } from '../api/_agent.js';

const route = prepareRoute(JSON.parse(readFileSync(new URL('../src/data/route-magdalena-santa-cruz.json', import.meta.url), 'utf8')));
const leg = route.legs.to_santa_cruz;
const jeep = (id, along, extra = {}) => {
  const [lng, lat] = pointAlong(leg, along);
  return { id, plate: id, direction: 'to_santa_cruz', lng, lat, seatsTotal: 20, seatsTaken: 5, updatedAt: new Date().toISOString(), ...extra };
};

describe('trip status', () => {
  it('only break, refueling and breakdown are out of service', () => {
    expect(STATUS_KEYS).toEqual(['on_trip', 'loading', 'break', 'refueling', 'breakdown']);
    expect(inService({ tripStatus: 'loading' })).toBe(true);
    expect(inService({})).toBe(true);
    for (const s of ['break', 'refueling', 'breakdown']) expect(inService({ tripStatus: s })).toBe(false);
  });

  it('tells riders what a jeepney is doing', () => {
    expect(riderStatusText({ tripStatus: 'on_trip' })).toBeNull();
    expect(riderStatusText({ tripStatus: 'loading' })).toMatch(/leaves when full/);
    expect(riderStatusText({ tripStatus: 'on_trip', lastTrip: true })).toBe('Last trip of the day');
    expect(markerTag({ tripStatus: 'breakdown', lastTrip: true })).toBe('Breakdown');
    expect(markerTag({ lastTrip: true })).toBe('Last trip');
  });

  it('a jeepney on break is never counted as coming to the rider', () => {
    const list = [jeep('ON BREAK', 1000, { tripStatus: 'break' }), jeep('MOVING', 500)];
    const coming = jeepsComingTo(route, list, 'to_santa_cruz', 3000);
    expect(coming.map((j) => j.plate)).toEqual(['MOVING']);
    // ...but it is still listed, with its status, when the AI lists jeepneys on the road.
    expect(describeJeepneys(route, list).find((j) => j.plate === 'ON BREAK').status).toBe('On break');
  });

  it('the AI server keeps valid statuses and drops made-up ones', () => {
    const { context } = _readInput({
      messages: [{ role: 'user', text: 'hi' }],
      context: { jeepneys: [jeep('A', 100, { tripStatus: 'loading', lastTrip: true }), jeep('B', 200, { tripStatus: 'teleporting' })] },
    });
    expect(context.jeepneys[0]).toMatchObject({ tripStatus: 'loading', lastTrip: true });
    expect(context.jeepneys[1].tripStatus).toBe('on_trip');
  });
});

describe('voice and earnings', () => {
  it('announces waiting passengers in Tagalog and English', () => {
    expect(PHRASES.waitingAhead(3, 'Capitol', 420, 'tl')).toBe('May 3 na pasahero na naghihintay sa Capitol, 400 metro sa unahan.');
    expect(PHRASES.waitingAhead(1, 'Capitol', 1500, 'en')).toBe('1 person waiting at Capitol, 1.5 kilometers ahead.');
    expect(PHRASES.arrived('Santa Cruz Plaza', 'Magdalena Plaza', 'tl')).toMatch(/^Dumating na sa Santa Cruz Plaza/);
  });

  it('take-home is kita minus krudo, boundary and other costs', () => {
    expect(net({ gross: 2500, fuel: 900, boundary: 800, other: 50 })).toBe(750);
    expect(net({ gross: 1000, fuel: 900, boundary: 800, other: 0 })).toBe(-700);
  });
});
