// Tagalog words for the app (see phrases.js).
import phrases from './phrases.js';

export default Object.fromEntries(phrases.filter((p) => p[1]).map((p) => [p[0], p[1]]));
