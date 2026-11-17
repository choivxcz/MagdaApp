// The app's copy of the landmarks (see landmarks.js). Kept separate so the
// server and tests can load the JSON their own way.
import data from '../data/landmarks.json';
import routeData from '../data/route-magdalena-santa-cruz.json';
import { makeLandmarks } from './landmarks.js';

export const landmarks = makeLandmarks(data, routeData);
export const LANDMARKS_UPDATED = data.updated;
