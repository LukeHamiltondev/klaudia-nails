import { nowInZone, toMinutes, toHHMM, isValidDate, isValidTime, dayKey, daysBetween } from "./time.js";
import { normalisePhone, isPlausiblePhone } from "./store.js";

export class BookingError extends Error {}

// The one place that decides what is bookable. The website and Klaudia's
// diary both go through this. One person, so one chair.
export class BookingService {
  constructor({ store, getSalon, clock = () => new Date() }) {
    this.store = store;
    this.getSalon = getSalon;
    this.clock = clock;
  }

  get salon() {
    return this.getSalon();
  }

  today() {
    return nowInZone(this.salon.timezone, this.clock()).date;
  }

  // Only treatments with a length can be booked; add-ons like Design go in the notes.
  service(id) {
    const s = this.salon.services.find((x) => x.id === id && x.minutes);
    if (!s) throw new BookingError(`Unknown treatment "${id}".`);
    return s;
  }

  // Why a date can't be booked, or null if it can.
  dateProblem(date) {
    if (!isValidDate(date)) return "That isn't a valid date.";
    const ahead = daysBetween(this.today(), date);
    if (ahead < 0) return "That date has already passed.";
    if (ahead > this.salon.maxDaysAhead) return `Bookings open ${this.salon.maxDaysAhead} days ahead.`;
    if (!this.salon.hours[dayKey(date)]) return "Closed that day.";
    return null;
  }

  isFree(date, start, end) {
    const clash = (s, e) => start < e && s < end;
    for (const b of this.store.activeBookingsOn(date)) {
      if (clash(toMinutes(b.start), toMinutes(b.end))) return false;
    }
    for (const bl of this.store.blocksOn(date)) {
      if (clash(toMinutes(bl.start), toMinutes(bl.end))) return false;
    }
    return true;
  }

  // Every start time ("10:15") where the treatment fits before closing.
  availability({ date, serviceId }) {
    const problem = this.dateProblem(date);
    if (problem) return { date, times: [], closedReason: problem };
    const svc = this.service(serviceId);
    const [open, close] = this.salon.hours[dayKey(date)].map(toMinutes);
    const now = nowInZone(this.salon.timezone, this.clock());
    const earliest = date === now.date ? now.minutes + this.salon.minNoticeMinutes : 0;
    const step = this.salon.slotIntervalMinutes;

    const times = [];
    for (let t = open; t + svc.minutes <= close; t += step) {
      if (t >= earliest && this.isFree(date, t, t + svc.minutes)) times.push(toHHMM(t));
    }
    return { date, times, closedReason: times.length ? null : "Fully booked that day." };
  }

  book({ serviceId, date, time, name, phone, notes = "", source }) {
    name = String(name || "").trim().slice(0, 80);
    if (!name) throw new BookingError("A name is needed for the booking.");
    if (!isPlausiblePhone(phone)) throw new BookingError("That phone number doesn't look right.");
    if (!isValidTime(time)) throw new BookingError("That isn't a valid time.");
    const svc = this.service(serviceId);
    const { times, closedReason } = this.availability({ date, serviceId });
    if (!times.includes(time)) throw new BookingError(closedReason && !times.length ? closedReason : "That time is no longer free.");

    return this.store.addBooking({
      serviceId: svc.id,
      serviceName: svc.name,
      price: svc.price,
      date,
      start: time,
      end: toHHMM(toMinutes(time) + svc.minutes),
      name,
      phone: normalisePhone(phone),
      notes: String(notes).slice(0, 300),
      source,
    });
  }
}
