/**
 * Compound timespan formatting.
 *
 * A duration is displayed as the largest unit it fills plus whatever is left
 * in the unit right below it: "1m30s", "2h30m", "1d3h", "1mo10d", "1y4mo13d".
 *
 * The suffixes are the ones Anki itself uses:
 *
 *   s = segundos   m = minutos   h = horas   d = dias   mo = meses   y = anos
 *
 * Only adjacent units are ever combined, so a label can never be read two
 * ways: "1m30s" is always one minute and thirty seconds, and a month is
 * always spelled "mo" (never "m", which is minutes).
 */

/** The units a timespan can be expressed in, from the smallest to the largest. */
export type TimespanUnit = 's' | 'm' | 'h' | 'd' | 'mo' | 'y';

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Anki normalises a month as a twelfth of a 365-day year. */
const MONTH = (365 * DAY) / 12;
const YEAR = 365 * DAY;

const UNIT_SECONDS: Record<TimespanUnit, number> = {
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  mo: MONTH,
  y: YEAR,
};

const UNIT_ORDER: TimespanUnit[] = ['s', 'm', 'h', 'd', 'mo', 'y'];

/**
 * Carry rules for when the smallest displayed unit overflows: `per` is the
 * count from which the value rolls over into the unit above it, and `keep` is
 * how many of them stay behind. Days and months do not divide evenly (a month
 * is 365/12 days), so a day overflow keeps the extra day instead of dropping it.
 */
const CARRY: Partial<Record<TimespanUnit, { per: number; keep: number }>> = {
  s: { per: 60, keep: 60 },
  m: { per: 60, keep: 60 },
  h: { per: 24, keep: 24 },
  d: { per: 31, keep: 30 },
  mo: { per: 12, keep: 12 },
};

interface TimespanPart {
  unit: TimespanUnit;
  count: number;
}

/** Rolls every overflow into the unit above it. */
function carryUp(parts: TimespanPart[]): void {
  for (let i = parts.length - 1; i > 0; i--) {
    const child = parts[i];
    const parent = parts[i - 1];
    const rule = CARRY[child.unit];
    if (!rule || child.count < rule.per) break;
    const times = Math.floor(child.count / rule.keep);
    parent.count += times;
    child.count -= times * rule.keep;
  }
}

/**
 * Splits a duration into the largest unit it fills plus the remainder in the
 * units below it.
 */
function decompose(seconds: number, maxUnit: TimespanUnit): TimespanPart[] {
  const maxIndex = UNIT_ORDER.indexOf(maxUnit);

  // The anchor is the largest unit the duration reaches — 27 hours are shown
  // as one day and three hours, not as twenty-seven hours.
  let anchor = 0;
  for (let i = 0; i <= maxIndex; i++) {
    if (seconds >= UNIT_SECONDS[UNIT_ORDER[i]]) anchor = i;
    else break;
  }

  let rest = seconds;
  const parts: TimespanPart[] = [];

  const anchorCount = Math.floor(rest / UNIT_SECONDS[UNIT_ORDER[anchor]]);
  parts.push({ unit: UNIT_ORDER[anchor], count: anchorCount });
  rest -= anchorCount * UNIT_SECONDS[UNIT_ORDER[anchor]];

  // The remainder goes into the unit right below the anchor. Years also show
  // the days left over, otherwise "1y4mo" would silently swallow a fortnight.
  const below: TimespanUnit[] = [];
  if (anchor >= 1) below.push(UNIT_ORDER[anchor - 1]);
  if (anchor === UNIT_ORDER.indexOf('y')) below.push(UNIT_ORDER[anchor - 2]);

  for (const unit of below) {
    const count = Math.floor(rest / UNIT_SECONDS[unit]);
    rest -= count * UNIT_SECONDS[unit];
    parts.push({ unit, count });
  }

  // Whatever is left is rounded into the smallest unit on display.
  const smallest = parts[parts.length - 1];
  smallest.count += Math.round(rest / UNIT_SECONDS[smallest.unit]);

  carryUp(parts);
  return parts;
}

/**
 * Formats a duration given in seconds.
 *
 * @param seconds  the duration
 * @param maxUnit  largest unit that may be used (learning steps never reach a month)
 */
export function formatTimespan(seconds: number, maxUnit: TimespanUnit = 'y'): string {
  if (!Number.isFinite(seconds)) return '0s';
  const total = Math.max(0, seconds);
  if (total === 0) return '0s';
  const text = decompose(total, maxUnit)
    .filter((part) => part.count > 0)
    .map((part) => `${part.count}${part.unit}`)
    .join('');
  return text || '0s';
}

/** Formats a duration given in days. */
export function formatTimespanDays(days: number, maxUnit: TimespanUnit = 'y'): string {
  return formatTimespan(days * DAY, maxUnit);
}

/** Formats a duration given in minutes. */
export function formatTimespanMinutes(minutes: number, maxUnit: TimespanUnit = 'y'): string {
  return formatTimespan(minutes * MINUTE, maxUnit);
}
