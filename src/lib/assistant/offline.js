// Answers common questions without any AI service: fares, next jeepney,
// free seats, stops, discounts, emergencies. Understands English, Tagalog
// and Taglish by keywords. Used when the AI is off, busy or unreachable.
import {
  normalize, findStopsInText, planTrip, describeJeepneys, jeepsComingTo, peso, FARE_RULES, DIRECTIONS,
} from './knowledge.js';

const has = (text, words) => words.some((w) => ` ${text} `.includes(` ${w} `));
const pick = (tl) => (tagalog, english) => (tl ? tagalog : english);

const TAGALOG = ['ba', 'po', 'ang', 'ng', 'mga', 'magkano', 'saan', 'nasaan', 'ilan', 'ilang', 'may', 'meron', 'wala', 'papunta', 'papuntang',
  'galing', 'mula', 'sasakay', 'sakay', 'bababa', 'upuan', 'pamasahe', 'kailan', 'susunod', 'ako', 'ko', 'kami', 'na', 'yung', 'kumusta',
  'salamat', 'paano', 'dadaan', 'dumadaan', 'hanggang', 'darating', 'ngayon', 'pauwi', 'tayo', 'naman', 'lang'];
const ENGLISH_Q = ['what', 'how', 'where', 'when', 'which', 'is there', 'are there', 'any', 'the'];

const WORDS = {
  emergency: ['emergency', 'aksidente', 'accident', 'saklolo', 'help me', 'nanakawan', 'holdap', 'hold up', 'snatcher', '911', 'pulis', 'police', 'ambulance', 'ambulansya'],
  fare: ['magkano', 'pamasahe', 'fare', 'fares', 'how much', 'bayad', 'price', 'cost', 'presyo', 'singil'],
  discount: ['student', 'students', 'estudyante', 'senior', 'seniors', 'pwd', 'discount', 'diskwento', 'discounted'],
  next: ['next', 'susunod', 'kailan', 'when', 'darating', 'dadating', 'arrive', 'arriving', 'eta', 'how long', 'gaano katagal', 'matagal', 'wait', 'hintay', 'malapit'],
  live: ['jeep', 'jeeps', 'jeepney', 'jeepneys', 'byahe', 'biyahe', 'nasaan', 'live', 'available', 'on the road'],
  seats: ['upuan', 'seat', 'seats', 'bakante', 'puno', 'full', 'space', 'maluwag', 'siksikan', 'room'],
  route: ['ruta', 'route', 'routes', 'dadaan', 'dumadaan', 'daan', 'stops', 'hintuan', 'babaan', 'sakayan', 'streets', 'street', 'kalye', 'via'],
  greet: ['hi', 'hello', 'hey', 'kumusta', 'kamusta', 'musta', 'good morning', 'good afternoon', 'good evening', 'magandang umaga', 'magandang hapon', 'magandang gabi'],
  thanks: ['salamat', 'thanks', 'thank you', 'ty', 'tnx'],
  show: ['show', 'ipakita', 'pakita', 'map', 'mapa', 'open', 'buksan'],
  toMarker: ['to', 'papunta', 'papuntang', 'pa', 'patungo', 'patungong', 'hanggang', 'punta', 'pupunta', 'bababa', 'baba', 'pauwi', 'pauwing', 'into', 'until'],
  fromMarker: ['from', 'galing', 'mula', 'sasakay'],
};

// Works out pickup and drop-off from words like "from X to Y",
// "X papuntang Y" or "galing X". Falls back to the order they appear.
// `toMarked` is true when the destination had a word like "papuntang" before it.
function readStops(route, raw) {
  const norm = ` ${normalize(raw)} `;
  let from = null;
  let to = null;
  let toMarked = false;
  const loose = [];
  for (const f of findStopsInText(route, raw)) {
    const before = norm.slice(Math.max(0, f.index - 16), f.index).trim().split(' ');
    const last = before[before.length - 1];
    const last2 = before.slice(-2).join(' ');
    if (!to && (WORDS.toMarker.includes(last) || last2 === 'going to')) { to = f.stop; toMarked = true; }
    else if (!from && (WORDS.fromMarker.includes(last) || WORDS.fromMarker.includes(before[before.length - 2]))) from = f.stop;
    else loose.push(f.stop);
  }
  for (const s of loose) {
    if (!from && (to || loose.length > 1) && s !== to) from = s;
    else if (!to && s !== from) to = s;
  }
  return { from, to, toMarked };
}

export function answerOffline(question, ctx) {
  const { route, jeepneys = [], fareType = 'regular' } = ctx;
  const memory = { ...(ctx.memory ?? {}) };
  const text = normalize(question);
  const tlCount = TAGALOG.filter((w) => has(text, [w])).length;
  const enCount = ENGLISH_Q.filter((w) => has(text, [w])).length;
  // Short follow-ups ("e sa Capitol?") keep the language of the last question.
  memory.tl = tlCount || enCount ? tlCount >= 2 || (tlCount === 1 && !enCount) : memory.tl ?? false;
  const t = pick(memory.tl);
  const reply = (message, actions = []) => ({ text: message, actions, memory });

  if (!text) return reply(t('Ano po ang gusto mong malaman?', 'What would you like to know?'));

  if (has(text, WORDS.emergency)) {
    return reply(t(
      'Kung may emergency, tumawag agad sa **911**. Nasa **More → Emergency** din ang mabilis na tawag. Pwede mo ring i-report ang biyahe sa **More → Report a ride**.',
      'If this is an emergency, call **911** right away. There is also a quick call button in **More → Emergency**. You can report a ride in **More → Report a ride**.',
    ));
  }

  const said = readStops(route, question);
  const mentioned = said.from || said.to;
  const isFare = has(text, WORDS.fare);
  const isLive = has(text, WORDS.next) || has(text, WORDS.seats) || has(text, WORDS.live);
  const isRoute = has(text, WORDS.route) && !mentioned && !has(text, WORDS.next) && !has(text, WORDS.seats);
  const isDiscount = has(text, WORDS.discount);
  const isShow = has(text, WORDS.show) && !!mentioned;
  const isTrip = isFare || isShow || !!(said.from && said.to);

  // "Kailan ang jeep sa Capitol?": a lone stop in a waiting question is the pickup.
  if (!isTrip && isLive && said.to && !said.from && !said.toMarked) {
    said.from = said.to;
    said.to = null;
  }

  // Trip slots carry over between questions ("magkano?" then "e sa Capitol?").
  if (said.from) memory.fromId = said.from.id;
  if (said.to) memory.toId = said.to.id;
  if (memory.fromId && memory.fromId === memory.toId) memory[said.from ? 'toId' : 'fromId'] = null;
  const fromId = memory.fromId ?? ctx.mapTrip?.fromId ?? null;
  const toId = memory.toId ?? ctx.mapTrip?.toId ?? null;

  if (isDiscount && !isTrip) {
    const pct = Math.round(FARE_RULES.discount * 100);
    return reply(t(
      `May **${pct}% discount** ang estudyante, senior at PWD. Ipakita lang ang ID sa driver. Mapapalitan mo ang fare type sa **More → Preferences**.`,
      `Students, seniors and PWD get a **${pct}% discount**. Show your ID to the driver. You can switch your fare type in **More → Preferences**.`,
    ));
  }

  if (isTrip) {
    if (!toId) return reply(t('Saan ka po papunta? Halimbawa: "Magdalena papuntang Santa Cruz Plaza".', 'Where are you going? For example: "Magdalena to Santa Cruz Plaza".'));
    if (!fromId) return reply(t(`Saan ka po sasakay papuntang ${stopName(route, toId)}?`, `Where will you ride from to get to ${stopName(route, toId)}?`));
    const trip = planTrip(route, fromId, toId);
    if (!trip) return reply(noTripText(route, fromId, toId, t));
    return tripReply(trip, { t, fareType, route, jeepneys, isShow, reply });
  }

  if (isRoute) {
    const out = route.legs.to_santa_cruz;
    const back = route.legs.to_magdalena;
    return reply([
      `${t('**Papuntang Santa Cruz:**', '**To Santa Cruz:**')} ${out.via}.`,
      `${t('**Pabalik ng Magdalena:**', '**To Magdalena:**')} ${back.via}.`,
      `${t('Mga hintuan:', 'Stops:')} ${out.stops.map((s) => s.short ?? s.name).join(' → ')}.`,
      t('Buong ruta at pamasahe kada hintuan ay nasa **Routes** tab.', 'The full route and fare per stop are in the **Routes** tab.'),
    ].join('\n'));
  }

  if (isLive) {
    let direction = directionFrom(text, said.toMarked ? said.to : null);
    const pickupId = said.from?.id ?? (mentioned ? null : fromId);
    if (!direction && pickupId && toId) direction = planTrip(route, pickupId, toId)?.direction ?? null;
    if (pickupId) return nextJeepReply({ t, route, jeepneys, pickupId, direction, reply });

    const list = describeJeepneys(route, jeepneys).filter((j) => !direction || j.direction === direction);
    if (!list.length) {
      return reply(t(
        `Wala pang jeep${direction ? ` ${dirTl(direction)}` : ''} na nagse-share ng location ngayon. Subukan ulit maya-maya.`,
        `No jeepney${direction ? ` ${dirEn(direction)}` : ''} is sharing its location right now. Try again in a few minutes.`,
      ));
    }
    const withSeats = list.filter((j) => !j.full).length;
    return reply([
      t(`May **${list.length}** jeep na bumibiyahe ngayon (${withSeats} may bakanteng upuan):`, `**${list.length}** jeepney${list.length === 1 ? '' : 's'} on the road now (${withSeats} with free seats):`),
      ...list.slice(0, 6).map((j) => `• **${j.plate}** ${t(dirTl(j.direction), dirEn(j.direction))}, ${t('malapit sa', 'near')} ${j.near} — ${seatsLine(j, t)}`),
      t('Sabihin kung saan ka sasakay para malaman kung kailan darating ang susunod.', 'Tell me where you’ll ride from and I’ll tell you when the next one arrives.'),
    ].join('\n'));
  }

  if (has(text, WORDS.thanks)) return reply(t('Walang anuman! Ingat sa biyahe. 🚙', 'You’re welcome! Have a safe ride. 🚙'));
  if (has(text, WORDS.greet)) return reply(helpText(t, true));

  // Just a place name ("Capitol"): use the remembered pickup if there is one.
  if (said.to && !said.from) {
    const trip = fromId && planTrip(route, fromId, said.to.id);
    if (trip) return tripReply(trip, { t, fareType, route, jeepneys, isShow: false, reply });
    return reply(t(
      `Papuntang ${said.to.name}? Saan ka po sasakay? Halimbawa: "galing Magdalena".`,
      `Going to ${said.to.name}? Where will you ride from? For example: "from Magdalena".`,
    ));
  }
  return reply(helpText(t, false));
}

// Why two stops can't be ridden between, e.g. a stop only one direction passes.
function noTripText(route, fromId, toId, t) {
  if (fromId === toId) return t('Pareho po ang sakayan at babaan. Pumili ng ibang hintuan.', 'Pickup and drop-off are the same stop. Choose a different one.');
  for (const id of [fromId, toId]) {
    const served = Object.keys(route.legs).filter((d) => route.legs[d].stops.some((s) => s.id === id));
    if (served.length === 1) {
      return t(
        `Ang ${stopName(route, id)} ay nadadaanan lang ng jeep ${dirTl(served[0])}. Sumakay o bumaba sa Sta. Cruz Plaza para lumipat ng direksyon.`,
        `${stopName(route, id)} is only passed by jeepneys ${dirEn(served[0])}. Ride to or from Santa Cruz Plaza to switch direction.`,
      );
    }
  }
  return t('Walang jeep sa rutang ito na dumadaan sa dalawang iyan. Subukan ang ibang hintuan.', 'No jeepney on this route connects those two stops. Try a different stop.');
}

function stopName(route, id) {
  return route.stops.find((s) => s.id === id)?.name ?? id;
}

const dirTl = (d) => (d === 'to_santa_cruz' ? 'papuntang Santa Cruz' : 'papuntang Magdalena');
const dirEn = (d) => DIRECTIONS[d].label.toLowerCase();

function directionFrom(text, saidTo) {
  if (saidTo?.id === 'santa-cruz-plaza' || /(papuntang|papunta|pa|to|patungong) (santa cruz|sta cruz)/.test(text)) return 'to_santa_cruz';
  if (saidTo?.id === 'magdalena-plaza' || /(papuntang|papunta|pa|to|patungong|pauwi|pauwing) (magdalena|magda)/.test(text)) return 'to_magdalena';
  return null;
}

function seatsLine(j, t) {
  if (j.seatsFree == null) return t('walang info sa upuan', 'no seat info');
  if (j.full) return t('**puno**', '**full**');
  return t(`**${j.seatsFree}** bakanteng upuan`, `**${j.seatsFree}** free seat${j.seatsFree === 1 ? '' : 's'}`);
}

function tripReply(trip, { t, fareType, route, jeepneys, isShow, reply }) {
  const discounted = fareType === 'discounted';
  const main = discounted ? trip.fareDiscounted : trip.fareRegular;
  const other = discounted ? trip.fareRegular : trip.fareDiscounted;
  const otherLabel = discounted ? 'regular' : t('estudyante/senior/PWD', 'student/senior/PWD');
  const coming = jeepsComingTo(route, jeepneys, trip.direction, trip.along);
  const next = coming.find((j) => !j.full) ?? coming[0];
  const name = (s) => s.short ?? s.name;
  const lines = [
    `**${name(trip.from)} → ${name(trip.to)}** (${t(dirTl(trip.direction), dirEn(trip.direction))}): **${peso(main)}** (${otherLabel}: ${peso(other)}).`,
    t(`Mga ${trip.km} km, mga ${trip.rideMinutes} minutong biyahe.`, `About ${trip.km} km, roughly a ${trip.rideMinutes}-minute ride.`),
    next
      ? t(
        `Susunod na jeep: **${next.plate}**, ${next.etaMinutes === 0 ? 'parating na' : `mga ${next.etaMinutes} min`} — ${seatsLine(next, t)}.`,
        `Next jeepney: **${next.plate}**, ${next.etaMinutes === 0 ? 'arriving now' : `in about ${next.etaMinutes} min`} — ${seatsLine(next, t)}.`,
      )
      : t('Wala pang jeep na papalapit sa sakayan mo ngayon.', 'No jeepney is heading to your pickup right now.'),
  ];
  if (isShow) lines.push(t('Ipinakita ko na sa mapa.', 'I’ve put it on the map.'));
  // auto: put it on the map right away (they asked to "show" it); otherwise offer a button.
  return reply(lines.join('\n'), [{ type: 'show_trip', direction: trip.direction, pickupStopId: trip.from.id, dropoffStopId: trip.to.id, auto: !!isShow }]);
}

function nextJeepReply({ t, route, jeepneys, pickupId, direction, reply }) {
  const parts = [];
  for (const d of direction ? [direction] : Object.keys(route.legs)) {
    const pickup = route.legs[d].stops.find((s) => s.id === pickupId);
    if (!pickup) continue;
    const name = pickup.short ?? pickup.name;
    const coming = jeepsComingTo(route, jeepneys, d, pickup.along);
    if (!coming.length) {
      parts.push(t(`Wala pang jeep ${dirTl(d)} na papalapit sa ${name}.`, `No jeepney ${dirEn(d)} is heading to ${name} right now.`));
      continue;
    }
    parts.push([
      t(`Papalapit sa **${name}** (${dirTl(d)}):`, `Coming to **${name}** (${dirEn(d)}):`),
      ...coming.slice(0, 3).map((j) => `• **${j.plate}** — ${j.etaMinutes === 0 ? t('parating na', 'arriving now') : t(`mga ${j.etaMinutes} min`, `~${j.etaMinutes} min`)}, ${seatsLine(j, t)}`),
    ].join('\n'));
  }
  return reply(parts.join('\n\n') || t('Hindi ko mahanap ang hintuang iyan sa ruta.', 'I couldn’t find that stop on the route.'));
}

function helpText(t, greeting) {
  return [
    greeting ? t('Kumusta! Ako si **Sakay AI**. 👋', 'Hi! I’m **Sakay AI**. 👋') : t('Pasensya, hindi ko masyadong naintindihan.', 'Sorry, I didn’t quite get that.'),
    t('Pwede mo akong tanungin ng:', 'You can ask me things like:'),
    t('• "Magkano Magdalena papuntang Santa Cruz?"', '• "How much from Magdalena to Santa Cruz?"'),
    t('• "May jeep ba papuntang Santa Cruz ngayon?"', '• "Any jeepneys to Santa Cruz right now?"'),
    t('• "Kailan darating ang jeep sa Capitol?"', '• "When is the next jeep at the Capitol?"'),
    t('• "Saan dumadaan ang jeep?"', '• "Which streets does the jeep pass?"'),
  ].join('\n');
}
