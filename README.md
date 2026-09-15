# myTS GotSport Probe

Standalone diagnostic only. It does **not** modify myTS or any database.

Default team: GotSport Rankings team `212707`.

## Deploy

```bash
npm install
npm run deploy
```

Then open the Worker URL. The probe starts automatically.

You can also open:

- `/api/probe` — JSON diagnostic for team 212707
- `/api/probe?team=123456` — test another GotSport Rankings team

The probe uses Cloudflare Browser Run through the `BROWSER` binding and captures the real browser/network evidence used by GotSport. It never asks for event IDs, team-registration IDs, group IDs, tournament URLs, iCal links, or a login.
