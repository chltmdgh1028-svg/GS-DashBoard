/**
 * Business date in Asia/Seoul - the date the centers operate on, which is what
 * the server keys its feed by. The browser's own timezone is deliberately
 * ignored so a client abroad still asks for the same operating day.
 */
export function currentBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
