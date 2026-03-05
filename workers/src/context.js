// RequestContext — per-request mutable state for subrequest tracking.
// Replaces the module-level _subrequestCount global to prevent
// concurrent requests from sharing/corrupting each other's counters.

const SUBREQUEST_LIMIT = 1000;
const SLACK_RESERVED = 5;

export function createContext() {
  return { subrequestCount: 0 };
}

export function canSubrequest(ctx) {
  return ctx.subrequestCount < (SUBREQUEST_LIMIT - SLACK_RESERVED);
}

export function trackSubrequest(ctx) {
  ctx.subrequestCount++;
}

export { SUBREQUEST_LIMIT, SLACK_RESERVED };
