import test from "node:test";
import assert from "node:assert/strict";
import { BookingService, BookingError } from "../src/bookings.js";
import { Store } from "../src/store.js";
import { salon, fixedClock, tmpDir } from "./helpers.js";

const make = (s = salon) => new BookingService({ store: new Store(tmpDir()), getSalon: () => s, clock: fixedClock });

test("today's times start after the notice period and finish by closing", () => {
  const svc = make();
  const { times } = svc.availability({ date: "2026-10-07", serviceId: "shellac" });
  assert.equal(times[0], "13:00"); // 11:00 now + 2 hours notice
  assert.equal(times.at(-1), "17:00"); // 60 min shellac must finish by 18:00
});

test("closed days, past days and days too far ahead have no times", () => {
  const svc = make();
  assert.match(svc.availability({ date: "2026-10-11", serviceId: "shellac" }).closedReason, /Closed/);
  assert.match(svc.availability({ date: "2026-10-06", serviceId: "shellac" }).closedReason, /passed/);
  assert.match(svc.availability({ date: "2027-01-25", serviceId: "shellac" }).closedReason, /days ahead/);
});

test("a booking blocks overlapping times and double booking is refused", () => {
  const svc = make();
  svc.book({ serviceId: "gel-extension", date: "2026-10-08", time: "12:00", name: "Aoife", phone: "087 123 4567", source: "test" });
  const times = svc.availability({ date: "2026-10-08", serviceId: "shellac" }).times;
  assert.ok(!times.includes("11:15") && !times.includes("12:00") && !times.includes("13:45"));
  assert.ok(times.includes("11:00") && times.includes("14:00"));
  assert.throws(() => svc.book({ serviceId: "nail-fix", date: "2026-10-08", time: "13:00", name: "Other", phone: "0861111111", source: "test" }), BookingError);
});

test("blocked time can't be booked", () => {
  const svc = make();
  svc.store.addBlock({ date: "2026-10-08", start: "13:00", end: "14:00" });
  const times = svc.availability({ date: "2026-10-08", serviceId: "nail-fix" }).times;
  assert.ok(!times.includes("13:00") && !times.includes("13:45") && times.includes("14:00") && times.includes("12:30"));
});

test("add-ons like Design can't be booked on their own", () => {
  const svc = make();
  assert.throws(() => svc.availability({ date: "2026-10-08", serviceId: "design" }), /Unknown treatment/);
});

test("bad input is rejected with a readable reason", () => {
  const svc = make();
  assert.throws(() => svc.book({ serviceId: "shellac", date: "2026-10-08", time: "12:00", name: "", phone: "0871234567" }), /name/);
  assert.throws(() => svc.book({ serviceId: "shellac", date: "2026-10-08", time: "12:00", name: "X", phone: "12" }), /phone/);
  assert.throws(() => svc.book({ serviceId: "acrylic", date: "2026-10-08", time: "12:00", name: "X", phone: "0871234567" }), /Unknown treatment/);
});
