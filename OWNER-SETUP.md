# Before going live

Fill these in `config/salon.json`. Until then the site shows them as "to confirm" or uses examples.

- [ ] `hours`: Klaudia's real opening hours. **The current ones are examples** so booking works; `null` means closed that day.
- [ ] Each service's `minutes`: how long each treatment really takes. **The current ones are examples.**
- [ ] `minNoticeMinutes` (now 2 hours) and `maxDaysAhead` (now 6 weeks): how late and how far ahead people can book
- [ ] `address`: studio address (and `mapsUrl`, a Google Maps link to it)
- [ ] `phoneDisplay`: phone number, if Klaudia wants one on the site (or delete the line)
- [ ] `email`: optional
- [ ] `bookingNote`, `tagline` and each service's `description`: check they say what she'd say

On the host:

- [ ] `ADMIN_PASSWORD`: a long password for her diary at `/admin`
- [ ] `PUBLIC_URL`: the live address, once there's a domain
- [ ] A persistent disk for `DATA_DIR` (`render.yaml` sets one up)
