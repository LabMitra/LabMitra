// Refunds an online payment for a CANCELLED booking. Called automatically when a patient
// cancels a paid booking, or by admin from the dashboard ("Issue refund").
// Uses the same secrets as the other Razorpay functions: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { booking_id } = await req.json();
    if (!booking_id) throw new Error("booking_id is required");

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: u, error: uErr } = await db.auth.getUser(token);
    if (uErr || !u?.user) throw new Error("Not signed in");

    const { data: b, error: bErr } = await db.from("bookings")
      .select("id, ref, user_id, total, status, payment, payment_method, razorpay_payment_id").eq("id", booking_id).single();
    if (bErr || !b) throw new Error("Booking not found");

    const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).single();
    const isAdmin = prof?.role === "admin";
    if (b.user_id !== u.user.id && !isAdmin) throw new Error("Not allowed");
    if (b.payment === "Refunded") return json({ ok: true, already: true });
    if (b.status !== "Cancelled" || b.payment !== "Refund pending") throw new Error("This booking is not waiting for a refund");
    if (b.payment_method !== "Online" || !b.razorpay_payment_id) throw new Error("No online payment found to refund");

    const auth = btoa(`${Deno.env.get("RAZORPAY_KEY_ID")}:${Deno.env.get("RAZORPAY_KEY_SECRET")}`);
    const res = await fetch(`https://api.razorpay.com/v1/payments/${b.razorpay_payment_id}/refund`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: b.total * 100, notes: { booking_ref: b.ref } }),
    });
    const refund = await res.json();
    if (!res.ok) throw new Error(refund?.error?.description || "Razorpay refund failed");

    const { error: upErr } = await db.from("bookings").update({ payment: "Refunded", refund_id: refund.id }).eq("id", b.id);
    if (upErr) throw upErr;
    return json({ ok: true, refund_id: refund.id });
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});
