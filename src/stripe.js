import crypto from "node:crypto";

// The two Stripe calls the deposit needs, over plain HTTPS so the app stays dependency-free.
export function makeStripe(secretKey, fetchImpl = fetch) {
  if (!secretKey) return null;
  async function call(method, path, params) {
    const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params ? new URLSearchParams(params).toString() : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Stripe ${path}: ${data.error?.message || res.status}`);
    return data;
  }
  return {
    // Stripe's hosted payment page for one deposit.
    createCheckoutSession({ bookingId, amountCents, currency, description, successUrl, cancelUrl, expiresAt, phone }) {
      return call("POST", "/checkout/sessions", {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": description,
        client_reference_id: bookingId,
        "metadata[booking_id]": bookingId,
        "payment_intent_data[metadata][booking_id]": bookingId,
        "payment_intent_data[metadata][phone]": phone,
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: String(Math.floor(expiresAt / 1000)),
      });
    },
    retrieveSession(id) {
      return call("GET", `/checkout/sessions/${encodeURIComponent(id)}`);
    },
  };
}

// Checks the Stripe-Signature header the way Stripe's own libraries do.
export function verifyWebhook(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!secret || !header) return false;
  const t = header.split(",").find((p) => p.startsWith("t="))?.slice(2);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(nowSeconds - Number(t)) > toleranceSeconds) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}
