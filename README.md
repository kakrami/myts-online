# myTS 7.5.0 — original interface, shared backend

Review candidate. Nothing has been deployed.

The interface comes from v6.20.133, including its existing styles, views, dialogs, Coach controls and browser exports. Its API boundary reads and writes the shared v7 model. Collection, reconciliation, analysis, file recovery and server exports use Durable Object alarms and continue after the browser closes. Polling only updates what the browser displays.

The ZIP contains exactly four files: `worker.js`, `wrangler.jsonc`, `package.json`, and this README. The original HTML, the ZIP reader and the server PDF font are embedded in `worker.js`; no asset directory, source tree, build script or other local file is required.

## Review and run

Use Node.js 22 or newer. Extract all four files into one directory, then run:

```sh
npm install
npm run build
npm run dev
```

`build` is a Wrangler dry run. It does not deploy. `dev` starts the local Worker. Open `/admin` to initialize a fresh local installation or sign in. A new installation uses the existing TeamSnap client-ID and owner-key flow. TeamSnap OAuth and Trace email codes require the providers to accept the configured callback origin.

The supplied configuration retains the v7 Worker name `myts-v7`, D1 binding `DB`, database `myts-v7-rebuild-data`, Durable Object binding `SYNC` / `SyncRuntime`, and one-minute cron. Review these values against the intended installation before any live deployment. Keep existing secrets and bindings. For a new installation, configure `ADMIN_KEY` as a Worker secret. Do not place passwords or provider tokens in these files.

This is a v7 shared-backend package. Do not point it directly at a v6 database. No database deletion, restore, production upload or deployment was performed while preparing it. Existing v7 installation handling remains in the backend.

After you approve the candidate, `npm run deploy` is the explicit deployment command.

## Behavior and verification

The original browser contract now covers setup, team/season selection, calendar and attendance, Trace statistics and detailed maps, GotSport competition fixtures and standings, followed teams, saved games, shared inclusion filters, corrections, branding, viewer links, Coach plans, diagnostics, and JSON/ZIP data recovery. Server commands retain the existing authorization, source scope and stale-write checks. Imported observations remain marked as file evidence. Separately edited roster identities are preserved when automatic name correspondence is considered.

Local checks exercise the original DOM and unchanged styles, native Worker/D1/alarms, browser-closed TeamSnap publication and JSON/ZIP recovery, populated Coach actions, conflicting edits, shared filters, viewer-link rotation, public whole-division fixtures and standings, saved games, branding, detailed-stat transport, and report files. The final bundled Worker is also checked independently of the development source tree.

Live Cloudflare deployment, current real-provider responses and phone/browser visual behavior still require your checks. Chromium could not be installed in this environment; the DOM checks are not a visual-browser pass.

The D1 usage download includes actual request measurements and the latest background invocation. The comparison button reports that historical v6 query measurements are unavailable; it does not invent an hourly comparison.

Suggested live review: confirm `/api/health` says 7.5.0; compare all original views on desktop and phone; connect each provider; close the browser while collecting and reopen; test one correction, filter, Coach plan, saved game, logo, kit and viewer-link rotation; export and reimport a small dataset before using a large archive.

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
