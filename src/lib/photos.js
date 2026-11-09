// Profile pictures and jeepney photos.
// Files live in the public "photos" bucket as <user id>/avatar.jpg and
// <user id>/jeepney.jpg. Photos are shrunk on the phone first, so an
// upload is ~100-300 KB even on a slow connection.
import { supabase } from './supabase.js';

const BUCKET = 'photos';
const SIZES = {
  avatar: { max: 512, square: true },
  jeepney: { max: 1280, square: false },
};

// `version` is when the photo last changed. Adding it to the link makes
// phones load the new picture instead of an old cached one.
export function photoUrl(userId, kind, version) {
  if (!supabase || !userId || !version) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(`${userId}/${kind}.jpg`);
  return `${data.publicUrl}?v=${version}`;
}

export async function fetchMyPhotos(userId) {
  const { data, error } = await supabase.rpc('my_photos').maybeSingle();
  if (error) throw error;
  return {
    avatar: photoUrl(userId, 'avatar', data?.avatar_v),
    jeepney: photoUrl(userId, 'jeepney', data?.jeepney_v),
  };
}

export async function uploadPhoto(userId, kind, file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  const blob = await shrinkImage(file, SIZES[kind]);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${userId}/${kind}.jpg`, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
  if (error) throw new Error(friendlyUploadError(error));
}

export async function removePhoto(userId, kind) {
  const { error } = await supabase.storage.from(BUCKET).remove([`${userId}/${kind}.jpg`]);
  if (error) throw error;
}

export async function removeAllMyPhotos(userId) {
  await supabase.storage.from(BUCKET).remove([`${userId}/avatar.jpg`, `${userId}/jeepney.jpg`]);
}

// What a rider sees after tapping a jeepney. Kept for a few minutes so
// tapping the same jeepney again opens instantly and saves data.
const CARD_TTL_MS = 5 * 60 * 1000;
const cards = new Map();

export async function fetchDriverCard(driverId) {
  const hit = cards.get(driverId);
  if (hit && Date.now() - hit.at < CARD_TTL_MS) return hit.card;
  const { data, error } = await supabase.rpc('driver_card', { p_driver_id: driverId }).maybeSingle();
  if (error) throw error;
  const card = data && {
    name: data.full_name,
    plate: data.plate,
    seats: data.seat_capacity,
    avatar: photoUrl(driverId, 'avatar', data.avatar_v),
    jeepney: photoUrl(driverId, 'jeepney', data.jeepney_v),
  };
  cards.set(driverId, { at: Date.now(), card });
  return card;
}

function friendlyUploadError(e) {
  const m = e?.message || String(e);
  if (/row-level security|unauthorized|not allowed/i.test(m)) return 'You can’t upload this photo. Try signing in again.';
  if (/exceeded|too large|payload/i.test(m)) return 'That photo is too big. Please choose another one.';
  if (/failed to fetch|network/i.test(m)) return 'No internet connection. Please try again.';
  return m;
}

async function loadImage(file) {
  // createImageBitmap turns phone photos upright (EXIF) on current browsers.
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older browsers: fall back to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('Couldn’t open that photo. Please choose a JPG or PNG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Resizes to at most `max` pixels on the long side (or a centered square)
// and saves as JPEG.
async function shrinkImage(file, { max, square }) {
  const img = await loadImage(file);
  const w = img.width, h = img.height;
  const side = Math.min(w, h);
  const [sx, sy, sw, sh] = square ? [(w - side) / 2, (h - side) / 2, side, side] : [0, 0, w, h];
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  img.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Couldn’t prepare that photo. Please try another one.');
  return blob;
}
