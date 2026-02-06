export const FAILED_BACKOFF_HOURS = 6;
export const REQUEST_STALE_HOURS = 48;

const REQUEST_CONFIRM_RULES = [
  { maxAgeHours: 1, cooldownHours: 0.25 },
  { maxAgeHours: 6, cooldownHours: 1 },
  { maxAgeHours: 24, cooldownHours: 3 },
  { maxAgeHours: REQUEST_STALE_HOURS, cooldownHours: 6 },
];

const STATUS_PRIORITY = {
  pending: 0,
  failed: 1,
  requested: 2,
  confirmed: 3,
};

export function normalizeStatusValue(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_PRIORITY, status)
    ? status
    : "";
}

export function pickForwardStatus(current, next) {
  const currentStatus = normalizeStatusValue(current);
  const nextStatus = normalizeStatusValue(next);
  if (!currentStatus) return nextStatus;
  if (!nextStatus) return currentStatus;
  return STATUS_PRIORITY[nextStatus] >= STATUS_PRIORITY[currentStatus]
    ? nextStatus
    : currentStatus;
}

export function hoursSince(value, now) {
  if (!value) return Infinity;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return (now.getTime() - parsed.getTime()) / (1000 * 60 * 60);
}

function getRequestedConfirmCooldownHours(requestedAgeHours) {
  for (const rule of REQUEST_CONFIRM_RULES) {
    if (requestedAgeHours <= rule.maxAgeHours) {
      return rule.cooldownHours;
    }
  }
  return REQUEST_CONFIRM_RULES[REQUEST_CONFIRM_RULES.length - 1].cooldownHours;
}

export function getRequestedConfirmAction({
  status,
  requestedAt,
  checkedAt,
  now,
}) {
  if (normalizeStatusValue(status) !== "requested") {
    return { action: "not-requested" };
  }

  const requestedAgeHours = hoursSince(requestedAt, now);
  if (!Number.isFinite(requestedAgeHours)) {
    return {
      action: "seed-requested-at",
      cooldownHours: REQUEST_CONFIRM_RULES[0].cooldownHours,
    };
  }

  if (requestedAgeHours >= REQUEST_STALE_HOURS) {
    return {
      action: "stale-failed",
      requestedAgeHours,
      cooldownHours: 0,
    };
  }

  const cooldownHours = getRequestedConfirmCooldownHours(requestedAgeHours);
  const checkedAgeHours = hoursSince(checkedAt, now);

  if (Number.isFinite(checkedAgeHours) && checkedAgeHours < cooldownHours) {
    return {
      action: "wait",
      requestedAgeHours,
      checkedAgeHours,
      cooldownHours,
    };
  }

  return {
    action: "confirm",
    requestedAgeHours,
    checkedAgeHours,
    cooldownHours,
  };
}

export function shouldMarkRequested(result) {
  if (result.ok && !result.syndicatedUrl) return true;
  if (result.error) return true;
  if (!result.ok && result.status >= 500) return true;
  if (!result.ok && result.status === 429) return true;
  return false;
}
