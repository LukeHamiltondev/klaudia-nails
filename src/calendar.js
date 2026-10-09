import { zonedToUtc } from "./time.js";

// A read-only iCalendar feed of Klaudia's bookings, for subscribing in Apple Calendar.

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 octets are folded onto continuation lines starting with a space.
function fold(line) {
  const out = [];
  let buf = Buffer.from(line, "utf8");
  while (buf.length > 75) {
    let cut = out.length ? 74 : 75;
    while ((buf[cut] & 0xc0) === 0x80) cut--; // don't split a multi-byte character
    out.push(buf.subarray(0, cut).toString("utf8"));
    buf = buf.subarray(cut);
  }
  out.push(buf.toString("utf8"));
  return out.join("\r\n ");
}

export function bookingsCalendar(bookings, salon, now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nails by Klaudia//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(`${salon.name} bookings`)}`,
    `X-WR-TIMEZONE:${salon.timezone}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    const details = [
      `Phone: ${b.phone}`,
      b.notes && `Notes: ${b.notes}`,
      `Price: ${b.price}`,
      b.deposit?.paid && `Deposit paid: €${b.deposit.amount}`,
      `Ref ${b.id}`,
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@klaudia-nails`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(zonedToUtc(b.date, b.start, salon.timezone))}`,
      `DTEND:${stamp(zonedToUtc(b.date, b.end, salon.timezone))}`,
      `SUMMARY:${text(`${b.serviceName}: ${b.name}`)}`,
      `DESCRIPTION:${text(details)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
