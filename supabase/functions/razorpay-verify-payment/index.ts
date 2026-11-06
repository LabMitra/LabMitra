// Verifies the HMAC-SHA256 signature Razorpay returns after a successful checkout, then
// marks the booking Paid. This is the only place a booking is allowed to become "Paid" for
// an online payment — the client can never set that directly.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

async function hmacHex(message: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("Missing payment details");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const authClient = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) throw new Error("Not signed in");

    const db = createClient(supabaseUrl, serviceKey);
    const { data: booking, error: bErr } = await db
      .from("bookings")
      .select("id, user_id, razorpay_order_id, payment")
      .eq("id", booking_id)
      .single();
    if (bErr || !booking) throw new Error("Booking not found");
    if (booking.user_id !== userData.user.id) throw new Error("This booking doesn't belong to you");
    if (booking.razorpay_order_id !== razorpay_order_id) throw new Error("Order mismatch");
    if (booking.payment === "Paid") {
      return new Response(JSON.stringify({ ok: true, already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const expected = await hmacHex(`${razorpay_order_id}|${razorpay_payment_id}`, keySecret);
    if (expected !== razorpay_signature) throw new Error("Payment signature verification failed");

    const { error: upErr } = await db
      .from("bookings")
      .update({ payment: "Paid", razorpay_payment_id })
      .eq("id", booking_id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
