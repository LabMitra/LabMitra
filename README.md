# LabMitra (Supabase)

## Fresh setup (new Supabase project)
1. Create a project at supabase.com.
2. SQL Editor: paste and run `supabase/schema.sql`. It contains everything: tables, security rules, timeline, cancel/reschedule, cash handovers, PDF bucket and sample tests.
3. Put your Project URL and anon/publishable key in `assets/supabase.js`.
4. Authentication > Providers > Email. For testing, turn off "Confirm email".
5. Fill in your business details in `assets/app.js` (`BUSINESS`, used on receipts) and the yellow placeholders in `privacy.html`.
6. Run locally with a static server (e.g. `npx serve .`) or deploy to Netlify/Vercel. Use HTTPS in production (needed for location and Google sign-in).

## Upgrading an existing project
If you ran an older `schema.sql`, run these in the SQL Editor, in this order (each is safe to re-run):
1. `add_email_to_profiles.sql`
2. `add_addresses.sql`
3. `staff_reports_upgrade.sql`
4. `add_payment_methods.sql`
5. `staff_shared_account.sql`
6. `staff_bookings_sync.sql`
7. `admin_users.sql`
8. `crucial_upgrade.sql` (age/gender, sample IDs, prep instructions, slot limits, cash handovers)
9. `features_upgrade.sql` (cancel/reschedule, refunds, timeline, privacy consent)

## Online payments (Razorpay), optional
Edge Functions in `supabase/functions/`: `razorpay-create-order`, `razorpay-verify-payment`, `razorpay-refund`.
    supabase link --project-ref <your-project-ref>
    supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx
    supabase functions deploy razorpay-create-order
    supabase functions deploy razorpay-verify-payment
    supabase functions deploy razorpay-refund
Without these, "Pay on arrival" works; online refunds show as "Refund pending" for admin to handle.

## Accounts
Sign up normally on the site, then in SQL Editor:
    update profiles set role='admin' where id=(select id from auth.users where email='you@example.com');
    update profiles set role='staff' where id=(select id from auth.users where email='staff@example.com');
- Admin: `98991/admin/login.html` → `98991/admin/dashboard.html` (overview, bookings, cash, users, test pricing, CSV exports).
- Staff (one shared account): `staff/login.html` → `staff/dashboard.html` (today's route, active jobs, report upload, history, cash handovers).
The admin folder is named `98991` so it isn't guessable. That's obscurity, not security: real access control is the role checks in Supabase (RLS policies and `has_role()`).

## Patient flow
Browse → Add to cart → Booking (patient age/gender, slot, address, consent, Cash or Online) → My bookings (track timeline, receipt, reschedule/cancel before the slot starts, download report).
Prices, slot capacity, past-slot rules and cancellation rules are all enforced in the database, not just in the browser.

## Not included yet
SMS/WhatsApp notifications (needs a provider), multiple patients in one booking, admin-editable slot times (edit `SLOTS` in `assets/app.js`), self-service account deletion (handled on request per the privacy policy).
