const S = { fill: "none", stroke: "currentColor" } as const;

export const Icon = {
  search: () => <svg width="16" height="16" viewBox="0 0 24 24" {...S} strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  bag: () => <svg width="22" height="22" viewBox="0 0 24 24" {...S} strokeWidth="1.7" aria-hidden="true"><path d="M5 8h14l-1 12H6z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>,
  user: () => <svg width="22" height="22" viewBox="0 0 24 24" {...S} strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg>,
  menu: () => <svg width="22" height="22" viewBox="0 0 24 24" {...S} strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>,
  check: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#23683A" strokeWidth="2.4" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>,
  truck: () => <svg width="26" height="26" viewBox="0 0 24 24" {...S} strokeWidth="1.6" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg>,
  repeat: () => <svg width="26" height="26" viewBox="0 0 24 24" {...S} strokeWidth="1.6" aria-hidden="true"><path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2" /><path d="M20 4v5h-5M4 20v-5h5" /></svg>,
  star: () => <svg width="26" height="26" viewBox="0 0 24 24" {...S} strokeWidth="1.6" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" /></svg>,
  lock: () => <svg width="26" height="26" viewBox="0 0 24 24" {...S} strokeWidth="1.6" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>,
  x: () => <svg width="20" height="20" viewBox="0 0 24 24" {...S} strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
};
