import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// null means demo mode: no database, simulated jeepneys.
export const supabase = url && key
  ? createClient(url, key, {
    auth: {
      // Email links put the sign-in tokens after "#" (see authLinks.js).
      flowType: 'implicit',
      // The phone app reads links itself; the website lets supabase-js do it.
      detectSessionInUrl: !Capacitor.isNativePlatform(),
    },
  })
  : null;
export const isDemo = !supabase;
