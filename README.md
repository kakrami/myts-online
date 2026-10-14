# myTS 7.5.2 — paused review candidate

Nothing has been deployed. This package defaults to `MYTS_UPGRADE_MODE: maintenance`.

The confirmed scheduler defect allowed an already admitted season projection to be claimed again while its source connections still had unreconciled revisions. This release applies the existing connection-readiness rule at both job claiming and wake selection. It preserves the build checkpoint, serves reconciliation first, and resumes the projection after the inputs settle. Existing failed/blocked/backoff source fallback remains available.

This fixes a demonstrated repeated-work path. It does not establish that this path caused all historical D1 reads or prove production usage is acceptable. The supplied database remains `myts-v7-rebuild-data` (`60f77502-33d4-41d6-80d4-1c5577ebba76`). Preserve every existing database.

## Paused behavior

While `MYTS_UPGRADE_MODE` is `maintenance`, API calls return HTTP 503 with `installation_maintenance`; cron returns before touching D1; and SyncRuntime wake, status and alarm handlers clear their pending alarm and return before touching D1 or providers. Checkpoints and stored data remain intact. `/api/health` returns version `7.5.2`, `state: paused`, and `reason: maintenance`. The original interface still loads, but its database features intentionally remain paused.

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

## Local verification

Scheduler tests cover withholding an admitted projection, wake timing behind a leased connection, resumption after reconciliation, and existing terminal/backoff fallback. A native D1 regression cycles six changing roster revisions without claiming the projection; each claim-plus-wake cycle uses five statements and reads 49 rows in that small fixture. This is a regression measurement, not a production usage forecast.

Suspension tests cover wake, alarm and status with maintenance and missing DB. Native bundled-Worker checks cover API calls, cron, wake, status and a real surviving alarm with zero D1 calls, preserved checkpoints and preserved owner data. Namespace-retention checks preserve the old runtime's SQLite and key/value data. Original-interface contract and browser-closed workflow checks run separately with maintenance absent to verify the retained functional paths.

Live Cloudflare costs and real-provider behavior remain unverified. Browser visual checks remain outstanding; local contract checks are not a visual-browser pass.

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
