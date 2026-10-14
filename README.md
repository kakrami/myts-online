# myTS 7.5.3 — paused query-cost review candidate

Nothing has been deployed during preparation. This four-file package defaults to `MYTS_UPGRADE_MODE: maintenance`.

Production diagnostics report 1,136 source events, 8,640 jobs, 413 retained projection runs and 90 publication rows. Of those jobs, 8,267 are Trace analytics, tracking or radar requests. Trace collects separate player, period and tracking-channel details, so this count alone does not establish duplicate work or an infinite loop. The ready analytics and tracking groups have mostly completed one saved page each. Do not delete those jobs or their data based on their count.

This release corrects two demonstrated query costs in the shared scheduler:

- After claiming a lease, its status updates now include the known `running` state. This lets the existing state index find the claimed job instead of scanning every retained job for its lease token. The updates remain inside the same atomic claim batch.
- Next-alarm selection seeks the earliest authorized unleased job separately for each eligible state using the existing state/time index. A separate lease check preserves the previous lease timing rule, including unusual saved non-running rows with live leases. Authorization, subscription generations, projection-input readiness, terminal states and nonrecurring completion checks remain in force. No new tables, indexes, polling intervals or persistent cache are introduced.

The 7.5.2 projection dependency correction remains: an already queued projection waits while its source connections have unreconciled input, then resumes with its checkpoint intact when the inputs settle. Existing failed/blocked/backoff source fallback remains available.

These are measured improvements in reproduced paths. They do not attribute all historical production reads or establish a safe production spending rate. The Cloudflare Guard is unchanged.

## Paused behavior

While `MYTS_UPGRADE_MODE` is `maintenance`, API calls return HTTP 503 with `installation_maintenance`; cron returns before touching D1; and SyncRuntime wake, status and alarm handlers clear their pending alarm and return before touching D1 or providers. Checkpoints and stored data remain intact. `/api/health` returns version `7.5.3`, `state: paused`, and `reason: maintenance`. The original interface still loads, but its database features intentionally remain paused.

Removing the DB binding also suspends SyncRuntime before D1 access. A deployment carries its configuration, including the DB binding: preserve the supplied maintenance setting during review. A surviving alarm clears when its handler runs. This does not cancel a request that was already executing under an older deployment.

Keep Cloudflare Guard armed. Its existing billing-cycle cutoff has already been exceeded, so fixing application code does not reset its accumulated usage. The guard may continue disabling the public URL. This release does not change the guard or override its limit. The guard itself still does not cancel Durable Object alarms; the application maintenance setting is a separate hold.

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

Do not resume normal collection yet. First confirm production D1 read growth has stopped while the application is held. A controlled resumption needs a separate decision about the guard's already exceeded billing-cycle cutoff and a short, measured trial of one existing connection. Record read deltas, checkpoint progress and job attempts before increasing work. No such production trial has been performed.

## Local verification and limits

A native D1 regression with 8,640 retained jobs and one due job reduces a complete claim from 8,662 rows read to 23. An idle claim reads 16 rows. This is a scheduler microbenchmark, not a production cost forecast.

A separate synthetic queue matches the reported 1,136 events and 8,640 jobs, including the supplied 8,267 Trace detail jobs grouped by component/state. Across all seven scheduler preferences, next-alarm selection reads 8,509–8,510 rows instead of 58,597, with exactly the same selected wake time in each comparison. This compares queue selection only; it is not a replay of production provider payloads or all 413 retained builds.

Passing checks include 108 targeted scheduler/readiness/suspension checks, 30 synchronization regressions, native D1 claim/readiness tests, four native public-history authority/depth checks, and all six original-interface workflow tests. The final bundled Worker is independently exercised for original setup, browser-closed TeamSnap publication, maintenance suspension and namespace retention. Its Wrangler dry run succeeds.

Two older native checks remain failing: `analysis-service-fairness.native.mjs` expects the retired installation count of 788 rather than 371, and the exact-budget case in `public-history-coordinator.native.mjs` expects a budget rejection under the earlier writer overhead. Both same failures were reproduced with only these two scheduler query changes reverted. Those checks are not reported as passing. Production schema and writer behavior were not changed to satisfy them.

The pause checks verify zero D1 calls through API, cron, wake, status and a real surviving native alarm, while preserving owner data and checkpoints. The retained MyTSRuntime namespace keeps its SQLite/key/value data and clears its old alarm.

Live query costs and real-provider behavior remain unverified. Browser visual checks remain outstanding. Keep maintenance enabled and the existing guard armed. Do not enable normal collection as part of reviewing this candidate. The guard still disables URLs and cron, rather than automatically applying the application's background maintenance hold.

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
