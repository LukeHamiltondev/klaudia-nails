const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const isPlaceholder = (v) => !v || /^PLACEHOLDER/i.test(String(v).trim());

// A value Klaudia still has to give us shows as a marked "to confirm" note instead of fake details.
const todo = (label) => `<span class="todo">${esc(label)} to confirm</span>`;

function instagramUrl(s) {
  return `https://www.instagram.com/${encodeURIComponent(s.instagramHandle)}/`;
}

// Booking is by Instagram message unless a booking page is set in salon.json.
function bookingUrl(s) {
  return s.bookingUrl || `https://ig.me/m/${encodeURIComponent(s.instagramHandle)}`;
}

function prices(s) {
  return s.services.map((x) => `
        <li class="price-row">
          <span class="price-name">${esc(x.name)}</span>
          <span class="price-amt">${esc(x.price)}</span>
          ${x.description ? `<span class="price-desc">${esc(x.description)}</span>` : ""}
        </li>`).join("");
}

function gallery(s) {
  return s.gallery.map((g, i) => `
        <figure class="shot shot-${i + 1}">
          <img src="${esc(g.src)}" alt="${esc(g.alt)}" loading="${i < 2 ? "eager" : "lazy"}">
          <figcaption>${String(i + 1).padStart(2, "0")}</figcaption>
        </figure>`).join("");
}

function hours(s) {
  return DAYS.map(([k, name]) => {
    const h = s.hours?.[k];
    const value = isPlaceholder(h) ? `<span class="muted">to confirm</span>` : esc(h);
    return `<tr><th scope="row">${name}</th><td>${value}</td></tr>`;
  }).join("");
}

function contact(s) {
  const rows = [];
  rows.push(isPlaceholder(s.address) ? todo("Address")
    : s.mapsUrl ? `<a href="${esc(s.mapsUrl)}" target="_blank" rel="noopener">${esc(s.address)}</a>` : esc(s.address));
  rows.push(isPlaceholder(s.phoneDisplay) ? todo("Phone number")
    : `<a href="tel:${esc(s.phoneDisplay.replace(/[^\d+]/g, ""))}">${esc(s.phoneDisplay)}</a>`);
  if (s.email && !isPlaceholder(s.email)) rows.push(`<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`);
  rows.push(`<a href="${esc(instagramUrl(s))}" target="_blank" rel="noopener">@${esc(s.instagramHandle)}</a>`);
  return rows.map((r) => `<li>${r}</li>`).join("");
}

export function renderPage(template, s, { publicUrl = "" } = {}) {
  const values = {
    name: esc(s.name),
    fullName: esc(s.fullName),
    tagline: esc(s.tagline),
    handle: esc(s.instagramHandle),
    handleUpper: esc(s.instagramHandle.toUpperCase()),
    priceListDate: esc(s.priceListDate),
    instagramUrl: esc(instagramUrl(s)),
    bookingUrl: esc(bookingUrl(s)),
    bookingLabel: s.bookingUrl ? "Book online" : "Book on Instagram",
    bookingNote: esc(s.bookingNote),
    publicUrl: esc(publicUrl),
    year: String(new Date().getFullYear()),
    prices: prices(s),
    gallery: gallery(s),
    hours: hours(s),
    contact: contact(s),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
}
