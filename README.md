# Nails by Klaudia

One-page website for Nails by Klaudia Kociubinska ([@klaudiakanails](https://www.instagram.com/klaudiakanails/)): price list, recent work, booking and where to find her. A small Node app with no dependencies, set up the same way as athlone-barber-club.

![The website on desktop](docs/screenshots/desktop-full.jpg)

- **Page** (`public/index.html`, `public/styles.css`): one HTML template, filled in on the server from `config/salon.json`, so prices and details are in the page itself (good for Google and link previews) and there's no JavaScript to load.
- **Look**: off-white paper, black heavy lowercase headings in Inter Tight, mono labels in JetBrains Mono and a burgundy scribble, taken from the logo and the 09/26 Instagram price list.
- **Booking**: the Book buttons open an Instagram message to @klaudiakanails. Put a booking page URL in `bookingUrl` and they switch to "Book online".

## Run it locally

```bash
cp .env.example .env   # optional
npm start              # http://localhost:3000
npm test               # 5 tests: prices on the page, placeholders, escaping, file serving
```

## Change prices, hours or details

Edit `config/salon.json`. The page reads it on every load, so there's no restart. Anything still starting with `PLACEHOLDER` shows on the site as "to confirm" and never as made-up details. See `OWNER-SETUP.md` for what's still needed.

## Photos

The six photos are in `public/images/gallery/` as `1.jpg` to `6.jpg`, each with alt text in the `gallery` list in `config/salon.json`. To add one, drop the file in and add a line there. The hero photo is `3.jpg`. The K mark in `public/brand/k-mark.png` is cut from the logo; a vector version from the designer would be sharper.

## Deploy

Any host that runs Node 20+ works. `render.yaml` sets it up on Render's free plan. Set `PUBLIC_URL` to the live address so link previews show the right photo.
