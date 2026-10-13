const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar3: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
  trophy: '<path d="M7 3h10v6a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v6m-4 1h8"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-4a7 7 0 0 1 14 0v4M17 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4Z"/>',
  'bookmark-fill': '<path d="M6 3h12v18l-6-4-6 4Z" fill="currentColor"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  sliders: '<path d="M5 3v7m0 4v7M12 3v3m0 4v11M19 3v11m0 4v3"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="19" cy="16" r="2"/>',
  'chevron-down': '<path d="m5 8 7 7 7-7"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  'x-lg': '<path d="m5 5 14 14M5 19 19 5"/>',
  'shield-lock': '<path d="m12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Z"/><rect x="8" y="10" width="8" height="6" rx="1"/><path d="M10 10V8a2 2 0 0 1 4 0v2"/>',
  'exclamation-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
  'arrow-right': '<path d="M3 12h17m-6-6 6 6-6 6"/>',
  'arrow-clockwise': '<path d="M20 7a9 9 0 1 0 1 9M20 2v6h-6"/>',
  'arrow-counterclockwise': '<path d="M4 7a9 9 0 1 1-1 9M4 2v6h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 5V3H4v14h2"/>',
  pencil: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m13 6 5 5"/>',
  funnel: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
  'camera-video': '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/>',
  'geo-alt': '<path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z"/><circle cx="12" cy="9" r="2"/>',
  star: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
  'bar-chart': '<path d="M4 21V11h4v10m2 0V6h4v15m2 0V2h4v19"/>',
  'file-earmark-excel': '<path d="M5 2h10l4 4v16H5ZM15 2v5h4m-10 4 6 7m0-7-6 7"/>',
  'file-earmark-pdf': '<path d="M5 2h10l4 4v16H5ZM15 2v5h4M8 17c4-1 7-5 4-7-2 1 0 8 4 7"/>',
  'box-arrow-in-right': '<path d="M14 3h7v18h-7M3 12h13m-5-5 5 5-5 5"/>',
  'link-45deg': '<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  'check2-circle': '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
};
export function icon(name, className = "") {
  const key = Object.hasOwn(paths, name) ? name : "exclamation-circle";
  const extra = String(className).replace(/[^a-zA-Z0-9_ -]/g, "");
  return `<svg class="bi bi-${key}${extra ? " " + extra : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[key]}</svg>`;
}
export function replaceIcons(html) {
  return String(html).replace(/<i class="bi bi-([a-z0-9-]+)"(?: aria-hidden="true")?><\/i>/g, (_, name) => icon(name));
}
