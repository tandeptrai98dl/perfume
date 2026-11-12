/** Cookie holding the id of the last dismissed announcement (shared by server and client). */
export const ANNOUNCEMENT_COOKIE = 'announcement_dismissed';

/** Set on <html> before first paint when an announcement was dismissed. */
export const ANNOUNCEMENT_DISMISSED_ATTRIBUTE = 'data-announcement-dismissed';

/**
 * Inline <head> script (locale layout). The announcement strip streams in after the static
 * shell, so the shell reserves its height (no layout shift when it arrives, §14.1); visitors
 * who dismissed an announcement get the attribute and `globals.css` drops the reserved space
 * before the first paint. Plain ES5, no dependencies.
 */
export function announcementPaintScript(): string {
  const pattern = `(?:^|;\\s*)${ANNOUNCEMENT_COOKIE}=`;
  return (
    `(function(){try{if(new RegExp(${JSON.stringify(pattern)}).test(document.cookie))` +
    `document.documentElement.setAttribute(${JSON.stringify(ANNOUNCEMENT_DISMISSED_ATTRIBUTE)},'');` +
    `}catch(e){}})();`
  );
}
