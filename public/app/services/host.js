/**
 * Where the page runs. The single-file build can be published to a page host that frames it
 * (marked by <meta name="ofg-host" content="embedded">). Inside that frame the page can't
 * start downloads and its own URL isn't the one people share, so those actions are hidden.
 */
export const embedded =
  typeof document !== "undefined" && document.querySelector('meta[name="ofg-host"]')?.getAttribute("content") === "embedded";
