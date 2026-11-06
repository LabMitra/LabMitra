// 1) Supabase Dashboard > Project Settings > API: paste Project URL and the anon/public key.
// Never put the service_role key here.
const SUPABASE_URL="https://olouwywieffhnzslkkia.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_vlYVB8jzCcldDcIqClslOg_6JMEb2HU";
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
