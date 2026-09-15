# myTS GotSport Probe

Standalone diagnostic only. It does **not** modify myTS or any database.

Default team: GotSport Rankings team `212707`.

## What v1.1 proves

1. Calls GotSport's public upcoming-matches JSON API directly.
2. Ties each upcoming event to this exact rankings team using the returned home/away `team_id` and its matching `*_team_reg_id`.
3. Opens the resulting public `?team=<event-team-id>` schedule in Cloudflare Browser Run.
4. Waits through GotSport's JavaScript verification page if it appears.
5. Accepts a division/group ID only when GotSport exposes it concretely in page state, links, forms, or returned JSON.
6. Opens the full public group schedule and records playoff/final evidence.

No name scoring, division guessing, event IDs, group IDs, tournament URLs, iCal links, or login are supplied manually.

## Deploy

```bash
npm install
npm run deploy
```

Then open the Worker URL. The probe starts automatically.

- `/api/probe` — JSON diagnostic for team 212707
- `/api/probe?team=123456` — test another GotSport Rankings team


## v1.2 focus

The probe now treats the captcha-protected public schedule page as a last-resort diagnostic only. It first uses GotSport's public upcoming-match JSON, inspects the Rankings JavaScript bundle for concrete API route evidence, and observes exact event-click network traffic looking for a bracket/schedule-level JSON source. It will accept a full schedule only when the returned data matches the concrete event/bracket/schedule IDs already supplied by GotSport.
