# myTS 7.5.4 — schema upgrade with collection held

Review candidate. Nothing has been deployed during preparation. The package still defaults to `MYTS_UPGRADE_MODE: maintenance`, which performs zero D1 work through ordinary API, cron and scheduler entry points.

Production reports `ready`, cursor 731, a non-current fingerprint and 416 old write guards. `ready` describes that older installation; it does not mean the current application schema is installed. Maintenance correctly prevented the deployment from advancing that schema. The guard count alone does not establish the cause of the historical read bill.

This release adds an explicit `upgrade-only` mode for updating the recognized existing database separately from restarting collection. It reuses the existing validated upgrade plan. It does not change the schema target, job data, database binding or namespace identities from 7.5.3. The original interface remains unchanged during normal operation.

## Upgrade-only behavior

With `MYTS_UPGRADE_MODE` set to `upgrade-only`:

- `/admin` displays a small database-maintenance form. Enter the installation key configured as this Worker's existing `ADMIN_KEY` secret. The key stays out of local storage and is cleared from the input immediately. Do not send it in chat.
- Each form request authenticates before inspection and advances one bounded schema page through `/api/owner/initialize`. This special handler never initializes an owner, changes the owner's password or creates a session. An empty or partially initialized database is refused.
- Requests must be same-origin. All ordinary application APIs remain blocked. `/api/health` is read-only and reports version 7.5.4 with `state: paused` and `reason: upgrade_only`.
- Cron and every SyncRuntime wake/status/alarm entry remain held before D1 access. A surviving alarm clears. No source fetch, collection, reconciliation, match analysis or publication job runs.
- The browser submits pages until the schema is current, then displays “Database updated. Collection remains paused.” Closing the browser interrupts the sequence; reopening and submitting the key resumes the committed cursor. There is no automatic switch to normal mode.

Only the authenticated upgrade operation performs database work. Every request has the existing 50-statement ceiling. This is a statement bound, not a hard billing cap; live upgrade read counts have not been measured.

## Proposed live procedure — requires approval before the guard exception

The current billing-cycle threshold is already exceeded, so Cloudflare Guard will keep disabling the public URL. A narrowly scoped temporary exception is necessary to use the maintenance form. The guard code and its threshold remain unchanged; other protected Workers remain protected.

After explicit approval for the upgrade-only window:

1. Deploy all four files with the supplied `maintenance` setting first. Preserve existing secrets and the D1 binding to `myts-v7-rebuild-data`.
2. Set myts-online's `MYTS_UPGRADE_MODE` variable to `upgrade-only` in Cloudflare. Do not use `normal` or remove the hold.
3. Append `myts-online` to Cloudflare Guard's existing comma-separated `EXCLUDE_WORKERS` variable, preserving all existing entries. Keep `ARMED` enabled. This is the temporary exception requiring approval.
4. Enable the production URL for `myts-online`, open `/admin`, enter the installation key and select Update database. Keep the page open until it reports completion.
5. In the D1 Console, run the read-only verification below. Expected: `ready`, `next_index=371`, `current_schema=1`, `old_write_guards=0`.
6. Set myts-online back to `MYTS_UPGRADE_MODE=maintenance`, then remove only the temporary `myts-online` exclusion from the guard. Preserve every other guard entry. Collection must remain paused for the separate cost review.

```sql
SELECT state, next_index,
  schema_fingerprint = '30116ace469e6b0b5146b62a7af632c2da63dad341b8d9d0044c1eb675af57c4' AS current_schema,
  (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND
    (name GLOB 'installation_epoch_*' OR name GLOB 'installation_upgrade_*'
     OR name GLOB 'team_games_journal_*'
     OR name IN('team_games_legacy_bridge','team_games_open_legacy','team_games_close_legacy'))
  ) AS old_write_guards
FROM setup_state WHERE id=1;
```

If any page fails, keep the hold enabled. Do not drop guards, alter setup records manually, delete databases or switch on normal collection. The fixed upgrade plan validates the recognized schema and can resume its own committed cursor.

## Verification

A native preserved-731 fixture with the existing extension complete matches the reported cursor and 416 old guards. Through the actual bundled Worker HTTP handler, 19 authenticated page requests reach the current 371-statement installation and zero old guards. Saved application rows compare exactly before and after, including owner/vault/credentials/sessions, source observations, jobs/leases/checkpoints, bookmarks and Coach records. Repeating the operation does not create a session or change those rows. Wrong-key and cross-origin requests are rejected; empty databases remain empty.

A separate native transition test also starts from the earlier 731 base without the extension, completes the existing path in 24 bounded steps, preserves application rows and rejects a stale writer after retirement. These are synthetic native D1 tests, not a copy of the production database.

The maintenance form is exercised in a DOM test, including repeated page submission, progress/completion, immediate clearing of the key input and absence of local-storage persistence. Native bundled checks verify zero D1 calls through ordinary API, cron and scheduler entry points in both maintenance and upgrade-only modes. The packaged Worker also passes normal original-interface setup and retained-namespace checks, along with 33 targeted readiness/suspension/bootstrap checks and a Wrangler dry run.

The inherited 7.5.3 scheduler optimizations remain unchanged: the single-due-job claim benchmark falls from 8,662 rows to 23, and next-alarm selection in a synthetic 1,136-event/8,640-job queue falls from 58,597 to about 8,510 while preserving selected wake times. Production usage after normal resumption remains unverified; the historical bill has not been fully attributed.

Two older native schema-count/budget tests documented in 7.5.3 remain known failures with the scheduler edits reverted as well. They are not represented as passing. Visual-browser and real-provider acceptance remain outstanding.

## Package and configuration

The ZIP contains exactly four files: `worker.js`, `wrangler.jsonc`, `package.json`, and this README. The v6.20.133 interface, ZIP reader and PDF font are embedded in the Worker. The shared v7 backend and existing workflow implementation are retained.

The configuration uses Worker `myts-online`, the existing D1 `DB` binding, `SYNC` / `SyncRuntime`, and one-minute cron. Both `MyTSRuntime` and `SyncRuntime` remain exported with SQLite storage. The retained MyTSRuntime keeps its namespace data and clears old alarms. There is no database deletion, namespace deletion, storage conversion or provider credential change. Keep existing secrets.

Extract all four files together. With Node.js 22 or newer:

```sh
npm install
npm run build
npm run dev
```

`build` is a Wrangler dry run. `dev` uses the supplied paused configuration. `/api/health` is available without D1 access. No database initialization is necessary for paused review. The deployment command is `npm run deploy`; it is not run during preparation.

## Embedded font license

The following license accompanies the embedded DejaVu PDF font:

Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: DejaVu fonts
Upstream-Author: Stepan Roh <src@users.sourceforge.net> (original author),
                  see /usr/share/doc/fonts-dejavu-core/AUTHORS for full list
Source: https://dejavu-fonts.github.io/

Files: *
Copyright: Copyright (c) 2003 by Bitstream, Inc. All Rights Reserved. 
 Bitstream Vera is a trademark of Bitstream, Inc.
 DejaVu changes are in public domain.
License: bitstream-vera
 Permission is hereby granted, free of charge, to any person obtaining a copy
 of the fonts accompanying this license ("Fonts") and associated
 documentation files (the "Font Software"), to reproduce and distribute the
 Font Software, including without limitation the rights to use, copy, merge,
 publish, distribute, and/or sell copies of the Font Software, and to permit
 persons to whom the Font Software is furnished to do so, subject to the
 following conditions:
 .
 The above copyright and trademark notices and this permission notice shall
 be included in all copies of one or more of the Font Software typefaces.
 .
 The Font Software may be modified, altered, or added to, and in particular
 the designs of glyphs or characters in the Fonts may be modified and
 additional glyphs or characters may be added to the Fonts, only if the fonts
 are renamed to names not containing either the words "Bitstream" or the word
 "Vera".
 .
 This License becomes null and void to the extent applicable to Fonts or Font
 Software that has been modified and is distributed under the "Bitstream
 Vera" names.
 .
 The Font Software may be sold as part of a larger software package but no
 copy of one or more of the Font Software typefaces may be sold by itself.
 .
 THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT,
 TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL BITSTREAM OR THE GNOME
 FOUNDATION BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, INCLUDING
 ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF
 THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM OTHER DEALINGS IN THE
 FONT SOFTWARE.
 .
 Except as contained in this notice, the names of Gnome, the Gnome
 Foundation, and Bitstream Inc., shall not be used in advertising or
 otherwise to promote the sale, use or other dealings in this Font Software
 without prior written authorization from the Gnome Foundation or Bitstream
 Inc., respectively. For further information, contact: fonts at gnome dot
 org.

Files: debian/*
Copyright: (C) 2005-2006 Peter Cernak <pce@users.sourceforge.net> 
           (C) 2006-2011 Davide Viti <zinosat@tiscali.it>
           (C) 2011-2013 Christian Perrier <bubulle@debian.org>
           (C) 2013 Fabian Greffrath <fabian+debian@greffrath.com>
License: GPL-2+
 This program is free software; you can redistribute it
 and/or modify it under the terms of the GNU General Public
 License as published by the Free Software Foundation; either
 version 2 of the License, or (at your option) any later
 version.
 .
 This program is distributed in the hope that it will be
 useful, but WITHOUT ANY WARRANTY; without even the implied
 warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 PURPOSE.  See the GNU General Public License for more
 details.
 .
 You should have received a copy of the GNU General Public
 License along with this package; if not, write to the Free
 Software Foundation, Inc., 51 Franklin St, Fifth Floor,
 Boston, MA  02110-1301 USA
 .
 On Debian systems, the full text of the GNU General Public
 License version 2 can be found in the file
 /usr/share/common-licenses/GPL-2'.
