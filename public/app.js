// Booking form. The page itself is rendered on the server; this only drives the four booking steps.
const $ = (s, el = document) => el.querySelector(s);
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const state = { salon: null, service: null, date: null, time: null };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayKeyOf = (date) => DAY_KEYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
const fmtDay = (date, opts) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { timeZone: "UTC", ...opts });
const fmtTime = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`; };
const fmtLength = (mins) => (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins} min`);

function pressed(container, btn) {
  container.querySelectorAll("[aria-pressed]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
}

function renderBooking(salon) {
  const services = $("#service-choices");
  services.innerHTML = salon.services.filter((s) => s.minutes).map((s) => `
    <button type="button" class="choice" aria-pressed="false" data-id="${esc(s.id)}">
      <strong>${esc(s.name)}</strong><span>${esc(s.price)} · ${fmtLength(s.minutes)}</span>
    </button>`).join("");
  services.addEventListener("click", (e) => {
    const btn = e.target.closest(".choice");
    if (!btn) return;
    pressed(services, btn);
    state.service = salon.services.find((s) => s.id === btn.dataset.id);
    $("#step-day").disabled = false;
    if (state.date) loadTimes(); else updateSummary();
  });

  const days = $("#day-choices");
  const count = Math.min(21, salon.maxDaysAhead + 1);
  days.innerHTML = Array.from({ length: count }, (_, i) => {
    const d = addDays(salon.today, i);
    const open = Boolean(salon.hours[dayKeyOf(d)]);
    const label = i === 0 ? "Today" : fmtDay(d, { weekday: "short" });
    return `<button type="button" class="day" aria-pressed="false" data-date="${d}" ${open ? "" : "disabled"} aria-label="${fmtDay(d, { weekday: "long", day: "numeric", month: "long" })}${open ? "" : ", closed"}">
      <small>${label}</small><b>${fmtDay(d, { day: "numeric" })}</b><small>${fmtDay(d, { month: "short" })}</small></button>`;
  }).join("");
  days.addEventListener("click", (e) => {
    const btn = e.target.closest(".day");
    if (!btn || btn.disabled) return;
    pressed(days, btn);
    state.date = btn.dataset.date;
    loadTimes();
  });

  $("#time-choices").addEventListener("click", (e) => {
    const btn = e.target.closest(".time");
    if (!btn) return;
    pressed($("#time-choices"), btn);
    state.time = btn.dataset.time;
    $("#step-details").disabled = false;
    updateSummary();
    $("#f-name").focus();
  });

  $("#booking").addEventListener("submit", submit);
  $("#book-another").addEventListener("click", () => location.reload());
}

async function loadTimes() {
  if (!state.service || !state.date) return;
  state.time = null;
  $("#step-details").disabled = true;
  updateSummary();
  const box = $("#time-choices");
  $("#step-time").disabled = false;
  box.innerHTML = `<p class="muted">Checking the diary…</p>`;
  const q = new URLSearchParams({ date: state.date, service: state.service.id });
  try {
    const res = await fetch(`/api/availability?${q}`);
    const data = await res.json();
    box.innerHTML = data.times?.length
      ? data.times.map((t) => `<button type="button" class="time" aria-pressed="false" data-time="${t}">${fmtTime(t)}</button>`).join("")
      : `<p class="muted">${esc(data.closedReason || data.error || "No free times that day.")} Try another day.</p>`;
  } catch {
    box.innerHTML = `<p class="form-error">Couldn't load times. Check your connection and pick the day again.</p>`;
  }
}

function updateSummary() {
  const s = state.service;
  $("#summary").textContent = s && state.date && state.time
    ? `${s.name} on ${fmtDay(state.date, { weekday: "long", day: "numeric", month: "long" })} at ${fmtTime(state.time)}, ${s.price}.`
    : "";
}

async function submit(e) {
  e.preventDefault();
  const form = e.target;
  const err = $("#form-error");
  err.textContent = "";
  const name = form.name.value.trim(), phone = form.phone.value.trim();
  if (!state.service || !state.date || !state.time) return (err.textContent = "Choose a treatment, a day and a time first.");
  if (!name) return (err.textContent = "Add your name so I know who's coming.");
  if (phone.replace(/\D/g, "").length < 9) return (err.textContent = "Add a mobile number in case I need to reach you.");

  const btn = $("#confirm");
  btn.disabled = true;
  btn.textContent = "Booking…";
  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: state.service.id, date: state.date, time: state.time,
        name, phone, notes: form.notes.value, website: form.website.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      err.textContent = data.error || "That booking didn't go through. Try again or message me on Instagram.";
      if (res.status === 400 && /no longer free/.test(data.error || "")) loadTimes();
      return;
    }
    form.hidden = true;
    $("#booked-text").textContent = `${data.service} on ${data.day} at ${data.time}, ${data.price}. Your reference is ${data.reference}.`;
    $("#booked").hidden = false;
    $("#booked").focus();
  } catch {
    err.textContent = "That booking didn't go through. Check your connection and try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm booking";
  }
}

try {
  state.salon = await (await fetch("/api/salon")).json();
  renderBooking(state.salon);
} catch {
  $("#service-choices").innerHTML = `<p class="form-error">Online booking couldn't load. Refresh the page, or message me on Instagram.</p>`;
}
