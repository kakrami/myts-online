import { escapeHTML as e, formatNumber, empty, button, dataAttrs } from "./presentation.js";
export function pitchMarkings() {
  return '<span class="squad-midline"></span><span class="squad-circle"></span><span class="squad-dot-center"></span><span class="squad-box top"></span><span class="squad-box bottom"></span><span class="squad-six top"></span><span class="squad-six bottom"></span><span class="squad-goal top"></span><span class="squad-goal bottom"></span>';
}
const layouts = {
  7: [{id:"GK",x:50,y:91},{id:"LB",x:25,y:70},{id:"RB",x:75,y:70},{id:"LM",x:20,y:45},{id:"CM",x:50,y:45},{id:"RM",x:80,y:45},{id:"ST",x:50,y:18}],
  9: [{id:"GK",x:50,y:91},{id:"LB",x:18,y:71},{id:"CB",x:50,y:73},{id:"RB",x:82,y:71},{id:"LM",x:20,y:45},{id:"CM",x:50,y:45},{id:"RM",x:80,y:45},{id:"LF",x:35,y:18},{id:"RF",x:65,y:18}],
};
const coordinate = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? Math.max(0,Math.min(100,value)) : fallback;
export function lineupPitch(model = {}, { editable = false, showSave = editable, action = "lineup-player", showMinutes = false } = {}) {
  if (![7,9].includes(Number(model.format))) return empty("Confirm 7v7 or 9v9 to show the lineup.");
  const roster = model.roster ?? model.players ?? [], byId = new Map(roster.map(p => [p.id,p]));
  const slots = model.slots ?? layouts[Number(model.format)].map(slot => ({...slot,player_id:model.field?.[slot.id] ?? null}));
  const selected = model.selected_player_id;
  const marker = slot => {
    const p = slot.player ?? byId.get(slot.player_id), pos = slot.position ?? slot.id;
    return `<button type="button" class="squad-player${p ? "" : " squad-empty"}" style="--x:${coordinate(slot.x,50)}%;--y:${coordinate(slot.y,50)}%" data-action="${e(action)}" data-slot="${e(slot.id)}" data-id="${e(p?.id ?? "")}"${dataAttrs({match:model.event_id})}${editable && p ? ' draggable="true"' : ""} aria-pressed="${!!p && p.id === selected}" aria-label="${e(p ? p.name+", "+pos : "Place player at "+pos)}"><span class="squad-disc ${p?.jersey ? "" : "no-number"}">${e(p?.jersey ?? pos)}<span class="squad-pos">${e(pos)}</span>${p?.goals ? '<span class="squad-goal-icon" aria-label="Goal">●</span>' : ""}</span><span class="squad-player-name">${e(p?.pitch_name ?? p?.name ?? "Place")}</span>${showMinutes && p ? `<small class="squad-player-minutes">${formatNumber(p.minutes,0)}′</small>` : ""}</button>`;
  };
  const bench = model.bench ?? roster.filter(p => !slots.some(slot => slot.player_id === p.id || slot.player?.id === p.id));
  return `<div class="match-lineup-card card"><div class="card-head"><h3>${e(model.title ?? "Lineup")}</h3>${showSave ? button("lineup-save","Save",{className:"btn small primary"}) : ""}</div><div class="squad-pitch-wrap"><div class="squad-pitch${editable ? " lineup-targets-visible" : ""}">${pitchMarkings()}${slots.map(marker).join("")}</div></div><div class="lineup-bench"><h4>${e(model.bench_title??"Substitutes")}</h4><div class="lineup-bench-list">${bench.map(p => `<button type="button" class="squad-player squad-player-bench ${p.id === selected ? "selected" : ""}" data-action="${e(action)}" data-id="${e(p.id)}" data-slot="bench"${dataAttrs({match:model.event_id})}${p.available===false ? " disabled" : editable ? ' draggable="true"' : ""}><span class="squad-disc">${e(p.jersey??"—")}</span><span class="squad-player-name">${e(p.name)}</span>${p.assignment_label ? `<small class="lineup-bench-meta">${e(p.assignment_label)}</small>` : ""}</button>`).join("") || '<span class="muted">None</span>'}</div></div></div>`;
}
const fullPitch = '<rect x="2" y="2" width="306" height="206" rx="4"/><path d="M155 2v206M2 56h48v98H2M308 56h-48v98h48"/><circle cx="155" cy="105" r="28"/>';
const halfPitch = '<rect x="2" y="2" width="306" height="226" rx="4"/><path d="M82 2v72h146V2M127 228a28 28 0 0 1 56 0"/>';
export function heatmapSVG(spatial, { title = "Heat map" } = {}) {
  if (!spatial) return empty("Map unavailable for this selection.");
  const grid = spatial.grid ?? spatial.values ?? spatial.cells, cols = Number(spatial.grid_cols ?? spatial.cols ?? spatial.width), rows = Number(spatial.grid_rows ?? spatial.rows ?? spatial.height);
  const cells = Array.isArray(grid) && Array.isArray(grid[0]) ? grid.flat() : grid;
  if (!Array.isArray(cells) || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols*rows !== cells.length || cells.length > 4096 || cells.some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return empty("Map unavailable for this selection.");
  const max = Math.max(...cells,0), rects = cells.map((v,i) => v > 0 && max > 0 ? `<rect x="${2+(i%cols)*306/cols}" y="${2+Math.floor(i/cols)*206/rows}" width="${306/cols+.3}" height="${206/rows+.3}" fill="#ffb84d" opacity="${Math.sqrt(v/max)*.88}"/>` : "").join("");
  const avg = typeof spatial.avg_x === "number" && typeof spatial.avg_y === "number" && spatial.avg_x >= 0 && spatial.avg_x <= 1 && spatial.avg_y >= 0 && spatial.avg_y <= 1 ? `<circle cx="${2+spatial.avg_x*306}" cy="${2+spatial.avg_y*206}" r="4" fill="#fff" stroke="#17251c"/>` : "";
  return `<div class="analytics-map"><svg viewBox="0 0 310 210" role="img" aria-label="${e(title)}"><rect x="0" y="0" width="310" height="210" rx="6" fill="#17653f"/>${rects}<g fill="none" stroke="#eef9ef" stroke-opacity=".7" stroke-width="1.5">${fullPitch}</g>${avg}</svg></div>`;
}
export function eventMapSVG(group, { kind = "events", title = "Event locations" } = {}) {
  const items = group?.items ?? group?.points;
  if (!Array.isArray(items) || items.length > 500) return empty("Map unavailable for this selection.");
  if (!items.length) return empty("No events recorded.");
  const half = ["box","shots"].includes(kind), height = half ? 230 : 210;
  const valid = p => typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const points = items.filter(valid), marks = points.map(p => {
    const x = 2+p.x*306,y = 2+p.y*(height-4), dest = p.destination;
    return `${dest && valid(dest) ? `<path d="M${x} ${y}L${2+dest.x*306} ${2+dest.y*(height-4)}" stroke="#f4c867" stroke-width="1.5"/>` : ""}<circle cx="${x}" cy="${y}" r="3.5" fill="#f4c867" stroke="#fff" stroke-width=".7"/>`;
  }).join("");
  return `<div class="analytics-map"><svg viewBox="0 0 310 ${height}" role="img" aria-label="${e(title)}"><rect width="310" height="${height}" rx="6" fill="#17653f"/><g fill="none" stroke="#eef9ef" stroke-opacity=".7" stroke-width="1.5">${half ? halfPitch : fullPitch}</g>${marks}</svg></div>${points.length < items.length ? `<p class="analytics-map-note">${points.length} of ${items.length} event locations available.</p>` : ""}`;
}
export function heatmapCard(spatial, title = "Match heat map") {
  return `<section class="card section"><div class="card-head"><h3>${e(title)}</h3></div><div class="card-body">${heatmapSVG(spatial,{title})}</div></section>`;
}
export function positionProfile(spatial = {}) {
  const thirds=[["def","Defensive third",spatial.defensive_third_pct],["mid","Middle third",spatial.middle_third_pct],["att","Attacking third",spatial.attacking_third_pct]];
  const valid=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=100;
  return `<section class="card section"><div class="card-head"><h3>Position profile</h3></div><div class="card-body"><div class="zonebar" aria-hidden="true">${thirds.filter(([,label,value])=>valid(value)).map(([cls,label,value])=>`<i class="${cls}" style="width:${value}%"></i>`).join("")}</div><div class="facts">${thirds.map(([,label,value])=>`<div class="fact"><span>${e(label)}</span><b>${valid(value) ? formatNumber(value,1)+"%" : "—"}</b></div>`).join("")}${typeof spatial.tracked_distance_m==="number"&&Number.isFinite(spatial.tracked_distance_m)&&spatial.tracked_distance_m>=0 ? `<div class="fact"><span>Tracked distance</span><b>${formatNumber(spatial.tracked_distance_m)} m</b></div>` : ""}</div></div></section>`;
}
