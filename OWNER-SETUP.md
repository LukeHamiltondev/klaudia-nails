# Before going live

Fill these in `config/salon.json`. Until then the site shows them as "to confirm" or uses examples.

- [ ] `hours`: Klaudia's real opening hours. **The current ones are examples** so booking works; `null` means closed that day.
- [ ] Each service's `minutes`: how long each treatment really takes. **The current ones are examples.**
- [ ] `minNoticeMinutes` (now 2 hours) and `maxDaysAhead` (now 6 weeks): how late and how far ahead people can book
- [ ] `slotIntervalMinutes` (now 30): how far apart start times are; smaller shows more times
- [ ] `address`: studio address (and `mapsUrl`, a Google Maps link to it)
- [ ] `phoneDisplay`: phone number, if Klaudia wants one on the site (or delete the line)
- [ ] `email`: optional
- [ ] `bookingNote`, `tagline` and each service's `description`: check they say what she'd say

On Railway:

- [ ] A volume attached to the service (mounted at `/data`), so bookings survive deploys
- [ ] `ADMIN_PASSWORD`: a long password for her diary at `/admin`
- [ ] `PUBLIC_URL`: only once she has her own domain; until then the Railway domain is used
