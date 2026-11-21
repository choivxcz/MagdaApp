// Bisaya (Cebuano) words for the app (see phrases.js).
import phrases from './phrases.js';

export default Object.fromEntries(phrases.filter((p) => p[2]).map((p) => [p[0], p[2]]));
