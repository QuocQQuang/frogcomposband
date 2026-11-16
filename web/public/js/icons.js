// Custom SVG vector icon set for FrogComposband (Obsidian & Tarnished Brass)

const SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

export const ICONS = {
  crest: `<svg ${SVG_ATTRS}><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z"/><path d="M12 7v10"/><path d="M9 11h6"/></svg>`,
  menu: `<svg ${SVG_ATTRS}><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`,
  settings: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  soundOn: `<svg ${SVG_ATTRS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  soundOff: `<svg ${SVG_ATTRS}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
  sidebar: `<svg ${SVG_ATTRS}><rect x="3" y="4" width="18" height="16" rx="1"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>`,
  book: `<svg ${SVG_ATTRS}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  dpad: `<svg ${SVG_ATTRS}><path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4z"/></svg>`,
  keys: `<svg ${SVG_ATTRS}><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6.01" y2="10"/><line x1="10" y1="10" x2="10.01" y2="10"/><line x1="14" y1="10" x2="14.01" y2="10"/><line x1="18" y1="10" x2="18.01" y2="10"/><line x1="7" y1="14" x2="17" y2="14"/></svg>`,
  target: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
  eye: `<svg ${SVG_ATTRS}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  wait: `<svg ${SVG_ATTRS}><path d="M6 3h12"/><path d="M6 21h12"/><path d="M8 3v4l4 5-4 5v4"/><path d="M16 3v4l-4 5 4 5v4"/></svg>`,
  rest: `<svg ${SVG_ATTRS}><path d="M12 4c2 2.5 3.5 5 3.5 7.5a3.5 3.5 0 0 1-7 0C8.5 9 10 6.5 12 4z"/><path d="M5 20l7-3 7 3"/></svg>`,
  search: `<svg ${SVG_ATTRS}><circle cx="11" cy="11" r="6"/><line x1="20" y1="20" x2="15.5" y2="15.5"/></svg>`,
  open: `<svg ${SVG_ATTRS}><path d="M5 21V4h10v17"/><path d="M15 4l4 2v13l-4 2"/><circle cx="12" cy="12" r="0.8"/></svg>`,
  close: `<svg ${SVG_ATTRS}><rect x="6" y="3" width="12" height="18"/><line x1="12" y1="3" x2="12" y2="21"/><circle cx="9.5" cy="12" r="0.8"/></svg>`,
  disarm: `<svg ${SVG_ATTRS}><path d="M12 3v3"/><path d="M5.6 5.6l2.1 2.1"/><path d="M18.4 5.6l-2.1 2.1"/><path d="M5 19l14-8"/><circle cx="15" cy="15" r="3"/></svg>`,
  get: `<svg ${SVG_ATTRS}><path d="M12 4v11"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/></svg>`,
  drop: `<svg ${SVG_ATTRS}><path d="M12 16V5"/><polyline points="7 9 12 4 17 9"/><path d="M5 20h14"/></svg>`,
  wear: `<svg ${SVG_ATTRS}><path d="M8 4l-4 3 2 4h2v9h8v-9h2l2-4-4-3-2 2h-4L8 4z"/></svg>`,
  quaff: `<svg ${SVG_ATTRS}><path d="M10 3h4"/><path d="M10 3v5l-4.5 7.5A2 2 0 0 0 7.2 18.5h9.6a2 2 0 0 0 1.7-3L14 8V3"/><line x1="7.5" y1="14" x2="16.5" y2="14"/></svg>`,
  read: `<svg ${SVG_ATTRS}><path d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6"/><path d="M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`,
  eat: `<svg ${SVG_ATTRS}><path d="M6 13c0-4 3-7 6-7s6 3 6 7v4H6v-4z"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`,
  fire: `<svg ${SVG_ATTRS}><path d="M5 19L19 5"/><polyline points="11 5 19 5 19 13"/><path d="M4 14l6 6"/></svg>`,
  cast: `<svg ${SVG_ATTRS}><polygon points="12 2 14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5 12 2"/></svg>`,
  power: `<svg ${SVG_ATTRS}><polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/></svg>`,
  zap: `<svg ${SVG_ATTRS}><line x1="4" y1="20" x2="16" y2="8"/><path d="M17 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>`,
  aim: `<svg ${SVG_ATTRS}><line x1="4" y1="20" x2="17" y2="7"/><circle cx="18" cy="6" r="2"/></svg>`,
  staff: `<svg ${SVG_ATTRS}><line x1="5" y1="20" x2="17" y2="4"/><circle cx="17" cy="4" r="2"/></svg>`,
  pack: `<svg ${SVG_ATTRS}><path d="M6 8h12l1 12H5L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,
  gear: `<svg ${SVG_ATTRS}><path d="M14.5 4.5l5 5-10 10H4.5v-5l10-10z"/><line x1="12" y1="7" x2="17" y2="12"/></svg>`,
  char: `<svg ${SVG_ATTRS}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>`,
  map: `<svg ${SVG_ATTRS}><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
  up: `<svg ${SVG_ATTRS}><path d="M5 19h4v-4h4v-4h4V7h3"/><polyline points="7 9 11 5 15 9"/></svg>`,
  down: `<svg ${SVG_ATTRS}><path d="M4 5h4v4h4v4h4v4h3"/><polyline points="11 15 15 19 19 15"/></svg>`,
  save: `<svg ${SVG_ATTRS}><path d="M5 3h11l4 4v14H5V3z"/><path d="M8 3v6h7V3"/><rect x="8" y="13" width="8" height="8"/></svg>`,
  trash: `<svg ${SVG_ATTRS}><polyline points="4 7 20 7"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>`,
  skull: `<svg ${SVG_ATTRS}><path d="M6 11a6 6 0 1 1 12 0c0 2.5-1.2 4-2 5v3H8v-3c-.8-1-2-2.5-2-5z"/><circle cx="9.5" cy="11.5" r="1"/><circle cx="14.5" cy="11.5" r="1"/></svg>`,
  crown: `<svg ${SVG_ATTRS}><path d="M3 18h18l-1.5-9-4.5 4-3-6-3 6-4.5-4L3 18z"/><line x1="4" y1="21" x2="20" y2="21"/></svg>`,
  play: `<svg ${SVG_ATTRS}><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
  closeX: `<svg ${SVG_ATTRS}><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
  layers: `<svg ${SVG_ATTRS}><rect x="3" y="4" width="18" height="16" rx="1"/><line x1="9" y1="4" x2="9" y2="20"/></svg>`,
};

export function iconHtml(name, cls = "") {
  const raw = ICONS[name] || "";
  if (!cls) return raw;
  return raw.replace("<svg ", `<svg class="${cls}" `);
}
