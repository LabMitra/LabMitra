// 1) Supabase Dashboard > Project Settings > API: paste Project URL and the anon/public key.
// Never put the service_role key here.
const SUPABASE_URL="https://olouwywieffhnzslkkia.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_vlYVB8jzCcldDcIqClslOg_6JMEb2HU";
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
// 2) Google Cloud > Clients > your Web client: paste the Client ID (ends with .apps.googleusercontent.com).
// It's public by design. NEVER put the Client Secret here; that only goes in Supabase.
const GOOGLE_CLIENT_ID="589560352461-4ilcsp1nolp1a54g7n3slf4fn8rpj4kt.apps.googleusercontent.com";
