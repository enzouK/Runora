import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTimespan,
  formatTimespanDays,
  formatTimespanMinutes,
  type TimespanUnit,
} from './timespan';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = (365 * DAY) / 12;
const YEAR = 365 * DAY;

const UNIT_ORDER: TimespanUnit[] = ['s', 'm', 'h', 'd', 'mo', 'y'];

/** Reads a label back into seconds, so a test can measure how far off it is. */
function labelToSeconds(label: string): number {
  const parts = [...label.matchAll(/(\d+)(mo|s|m|h|d|y)/g)];
  return parts.reduce((total, part) => {
    const value = Number(part[1]);
    const unit = part[2] as TimespanUnit;
    const factor =
      unit === 's' ? 1 : unit === 'm' ? MINUTE : unit === 'h' ? HOUR : unit === 'd' ? DAY : unit === 'mo' ? MONTH : YEAR;
    return total + value * factor;
  }, 0);
}

/** The units a label is built from, in display order. */
function labelUnits(label: string): TimespanUnit[] {
  return [...label.matchAll(/\d+(mo|s|m|h|d|y)/g)].map((part) => part[1] as TimespanUnit);
}

describe('formatTimespan', () => {
  it('formats seconds, minutes and hours', () => {
    assert.equal(formatTimespan(0), '0s');
    assert.equal(formatTimespan(30), '30s');
    assert.equal(formatTimespan(45), '45s');
    assert.equal(formatTimespan(59), '59s');
    assert.equal(formatTimespan(MINUTE), '1m');
    assert.equal(formatTimespan(90), '1m30s');
    assert.equal(formatTimespan(100), '1m40s');
    assert.equal(formatTimespan(10 * MINUTE), '10m');
    assert.equal(formatTimespan(HOUR), '1h');
    assert.equal(formatTimespan(2.5 * HOUR), '2h30m');
  });

  it('formats days, months and years', () => {
    assert.equal(formatTimespan(DAY), '1d');
    assert.equal(formatTimespan(12 * DAY), '12d');
    assert.equal(formatTimespan(29 * DAY), '29d');
    assert.equal(formatTimespan(30 * DAY), '30d');
    assert.equal(formatTimespan(31 * DAY), '1mo1d');
    assert.equal(formatTimespan(40 * DAY), '1mo10d');
    assert.equal(formatTimespan(45 * DAY), '1mo15d');
    assert.equal(formatTimespan(60 * DAY), '1mo30d');
    assert.equal(formatTimespan(61 * DAY), '2mo');
    assert.equal(formatTimespan(180 * DAY), '5mo28d');
    assert.equal(formatTimespan(364 * DAY), '11mo29d');
    assert.equal(formatTimespan(YEAR), '1y');
    assert.equal(formatTimespan(366 * DAY), '1y1d');
    assert.equal(formatTimespan(500 * DAY), '1y4mo13d');
    assert.equal(formatTimespan(1000 * DAY), '2y8mo27d');
    assert.equal(formatTimespan(36500 * DAY), '100y');
  });

  it('rounds the remainder instead of truncating it', () => {
    // 30.5 seconds rounds up to 31s, 59m36s keeps the seconds.
    assert.equal(formatTimespan(30.5), '31s');
    assert.equal(formatTimespan(59 * MINUTE + 36), '59m36s');
    // 1h59m36s rounds the minutes up and carries into the hour.
    assert.equal(formatTimespan(HOUR + 59 * MINUTE + 36), '2h');
  });

  it('clamps negative and non-finite values', () => {
    assert.equal(formatTimespan(-10), '0s');
    assert.equal(formatTimespan(Number.NaN), '0s');
    assert.equal(formatTimespan(Number.POSITIVE_INFINITY), '0s');
  });

  it('never combines units that are not adjacent', () => {
    const samples = [0.001, 0.5, 1, 1.5, 2, 10, 27, 30, 31, 40, 100, 364, 365, 500, 1000, 36500];
    for (const days of samples) {
      const label = formatTimespanDays(days);
      const units = labelUnits(label);
      assert.ok(units.length >= 1, label);
      for (let i = 1; i < units.length; i++) {
        const previous = UNIT_ORDER.indexOf(units[i - 1]);
        const current = UNIT_ORDER.indexOf(units[i]);
        assert.ok(current < previous, `${label}: units are not in descending order`);
        assert.equal(previous - current, 1, `${label}: ${units[i - 1]} and ${units[i]} are not adjacent`);
      }
      // At most three parts, and the third one only shows up for years.
      assert.ok(units.length <= 3, label);
      if (units.length === 3) assert.equal(units[0], 'y', label);
    }
  });

  it('stays much closer to the real duration than a decimal label', () => {
    const samples = [0.001, 0.5, 1, 1.5, 2, 10, 27, 30, 31, 40, 100, 364, 365, 500, 1000];
    for (const days of samples) {
      const label = formatTimespanDays(days);
      const error = Math.abs(labelToSeconds(label) - days * DAY);
      // Below a day the label is exact down to the second; above it the
      // remainder is rounded to the nearest day.
      const tolerance = days < 1 ? MINUTE : DAY;
      assert.ok(error <= tolerance, `${label} is off by ${error}s`);
    }
  });
});

describe('formatTimespanDays', () => {
  it('formats a duration given in days', () => {
    assert.equal(formatTimespanDays(20), '20d');
    assert.equal(formatTimespanDays(0.5), '12h');
    assert.equal(formatTimespanDays(1 / 24), '1h');
    assert.equal(formatTimespanDays(1 / 1440), '1m');
  });
});

describe('formatTimespanMinutes', () => {
  it('formats a duration given in minutes', () => {
    assert.equal(formatTimespanMinutes(1), '1m');
    assert.equal(formatTimespanMinutes(10), '10m');
    assert.equal(formatTimespanMinutes(0.5), '30s');
    assert.equal(formatTimespanMinutes(60), '1h');
    assert.equal(formatTimespanMinutes(90), '1h30m');
    assert.equal(formatTimespanMinutes(1440), '1d');
    assert.equal(formatTimespanMinutes(1.5), '1m30s');
  });

  it('stops at days when the unit is capped', () => {
    assert.equal(formatTimespanMinutes(45 * 1440, 'd'), '45d');
    assert.equal(formatTimespanMinutes(500 * 1440, 'd'), '500d');
    assert.equal(formatTimespanMinutes(60, 'd'), '1h');
  });
});
