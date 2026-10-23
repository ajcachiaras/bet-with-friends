// Your Supabase project's address and publishable key, from the dashboard's
// Connect dialog (or Project Settings > API Keys).
//
// Both are meant to be public: they ship to every visitor's browser. What
// keeps data safe is the row level security in supabase/migrations. Never put
// the secret key (sb_secret_...) or the database password here.
export const SUPABASE_URL = 'https://uzjxghdvhvycalucakok.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Hcy5ghckA3RGUKJFcXy0gw_tM2PL07z';

// Public half of the push-notification signing key pair. The private half is
// the VAPID_PRIVATE_KEY secret on the send-push Supabase function.
export const VAPID_PUBLIC_KEY = 'BDXZt0NAhdymwCKJVsFeky0YvLlT9L1nJ-mBqpaN4fAPd5Fp9hsk74fs48jHitjEL1FSseymy1N3cSKt-1LbHUo';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_PUBLISHABLE_KEY.includes('YOUR-KEY');
