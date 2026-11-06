// Creates a Razorpay order for an existing booking. The amount is re-read from the
// bookings table (never trusted from the client), same tamper-proofing idea as place_booking().
//
// Secrets needed (set once): supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { booking_id } = await req.json();
    if (!booking_id) throw new Error("booking_id is required");

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their JWT (sent automatically by supabase-js's functions.invoke).
    const authClient = createClient(supabaseUrl, serviceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) throw new Error("Not signed in");

    // Service-role client bypasses RLS — we enforce ownership manually below instead.
    const db = createClient(supabaseUrl, serviceKey);
    const { data: booking, error: bErr } = await db
      .from("bookings")
      .select("id, ref, total, user_id, payment, payment_method")
      .eq("id", booking_id)
      .single();
    if (bErr || !booking) throw new Error("Booking not found");
    if (booking.user_id !== userData.user.id) throw new Error("This booking doesn't belong to you");
    if (booking.payment_method !== "Online") throw new Error("This booking isn't set up for online payment");
    if (booking.payment === "Paid") throw new Error("This booking is already paid");

    const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const auth = btoa(`${keyId}:${keySecret}`);

    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: booking.total * 100, // paise
        currency: "INR",
        receipt: booking.ref,
        notes: { booking_id: booking.id },
      }),
    });
    const order = await rpRes.json();
    if (!rpRes.ok) throw new Error(order?.error?.description || "Razorpay order creation failed");

    await db.from("bookings").update({ razorpay_order_id: order.id }).eq("id", booking.id);

    return new Response(
      JSON.stringify({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: keyId, ref: booking.ref }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
