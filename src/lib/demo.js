// Simulated jeepneys for demo mode, so the rider map works before
// Supabase is set up. Positions depend only on the clock, so every
// refresh shows them moving smoothly around the loop.
import { pointAlong } from './geo.js';

const FLEET = [
  { id: 'demo-1', plate: 'DEMO 101', offset: 0.05, seats: 20 },
  { id: 'demo-2', plate: 'DEMO 202', offset: 0.3, seats: 18 },
  { id: 'demo-3', plate: 'DEMO 303', offset: 0.55, seats: 22 },
  { id: 'demo-4', plate: 'DEMO 404', offset: 0.8, seats: 20 },
];
const SPEED = 6; // meters per second, about 22 km/h

export function demoJeepneys(route) {
  const out = route.legs.to_santa_cruz;
  const back = route.legs.to_magdalena;
  const loop = out.length + back.length;
  const t = Date.now() / 1000;

  return FLEET.map((j, i) => {
    const pos = (j.offset * loop + t * SPEED) % loop;
    const goingOut = pos < out.length;
    const leg = goingOut ? out : back;
    const [lng, lat] = pointAlong(leg, goingOut ? pos : pos - out.length);
    // Passengers change slowly; one jeepney is always full to show that state.
    const wave = Math.sin(t / 90 + i * 1.7) * 0.5 + 0.5;
    const seatsTaken = i === 2 ? j.seats : Math.round(wave * j.seats * 0.9);
    return {
      id: j.id,
      plate: j.plate,
      direction: leg.direction,
      lng,
      lat,
      seatsTotal: j.seats,
      seatsTaken,
      updatedAt: new Date(),
    };
  });
}
