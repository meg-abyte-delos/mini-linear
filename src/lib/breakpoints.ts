/** Shared layout breakpoint: at or below NARROW_PX the sidebar becomes a drawer and the Inbox preview pane is hidden (keep in sync with the 900px media queries in CSS). */
export const NARROW_PX = 900;
export const NARROW_MQ = `(max-width: ${NARROW_PX}px)`;
// Strictly above NARROW_PX so the two queries never both match at exactly 900px.
export const WIDE_MQ = `(min-width: ${NARROW_PX + 1}px)`;
