import { describe, expect, it } from 'vitest';
import { fixture, load } from './helpers';
import { parseActivity } from '../src/lib/activity/parse';
import { detectFormat } from '../src/lib/activity/detect';
import { computeMetrics, elevationGainLoss } from '../src/lib/activity/metrics';
import { formatMetric, formatPace, formatDuration } from '../src/lib/activity/format';
import { ActivityImportError } from '../src/lib/activity/errors';

describe('format detection', () => {
  it('detects by content, not extension', () => {
    expect(detectFormat(fixture('straight-5k.gpx'))).toBe('gpx');
    expect(detectFormat(fixture('straight-5k.tcx'))).toBe('tcx');
    expect(detectFormat(fixture('straight-5k.fit'))).toBe('fit');
    expect(detectFormat(fixture('actually-gpx.tcx'))).toBe('gpx');
    expect(detectFormat(fixture('not-activity.gpx'))).toBeNull();
  });
  it('warns when extension and contents disagree', () => {
    const a = load('actually-gpx.tcx');
    expect(a.source.format).toBe('gpx');
    expect(a.warnings[0]).toMatch(/named \.tcx/);
  });
});

describe('GPX import', () => {
  const a = load('straight-5k.gpx');
  const m = computeMetrics(a);
  it('parses points, hr and cadence (strides → steps/min)', () => {
    expect(a.name).toBe('Straight 5K');
    expect(a.points.length).toBeGreaterThan(1600);
    expect(a.points[0].hr).toBe(150);
    expect(a.points[0].cad).toBe(170);
    expect(a.startTime).toBe(Date.parse('2026-05-03T05:30:00Z'));
  });
  it('computes distance from GPS within 0.1%', () => {
    expect(m.distanceSource).toBe('gps');
    expect(m.distanceM!).toBeCloseTo(5000, -1);
    expect(Math.abs(m.distanceM! - 5000) / 5000).toBeLessThan(0.001);
  });
  it('excludes the 60 s stop from moving time', () => {
    expect(m.movingS!).toBeCloseTo(5000 / 3, 0);
    expect(m.elapsedS!).toBeCloseTo(5000 / 3 + 60, 0);
  });
  it('derives pace and speed from moving time', () => {
    expect(m.avgPaceSPerKm!).toBeCloseTo(1000 / 3, 0); // 5:33 /km
    expect(formatPace(m.avgPaceSPerKm!, 'metric')).toBe('5:33');
    expect(m.avgSpeedMps!).toBeCloseTo(3, 2);
    expect(m.maxSpeedMps!).toBeCloseTo(3, 1);
  });
  it('computes elevation gain/loss with smoothing + hysteresis', () => {
    expect(m.elevGainM!).toBeGreaterThan(47);
    expect(m.elevGainM!).toBeLessThan(51);
    expect(m.elevLossM!).toBeGreaterThan(47);
    expect(m.minEleM).toBe(0);
    expect(m.maxEleM!).toBeCloseTo(50, 0);
  });
  it('builds km splits with interpolated boundaries', () => {
    expect(m.splits).toHaveLength(5);
    expect(m.splits[0].durationS).toBeCloseTo(1000 / 3, 0);
    // split 3 contains the 60 s stop
    expect(m.splits[2].durationS).toBeCloseTo(1000 / 3 + 60, 0);
    expect(m.bestPaceSPerKm!).toBeCloseTo(1000 / 3, 0);
  });
  it('time-weights heart rate and cadence', () => {
    expect(m.avgHr).toBeCloseTo(150, 5);
    expect(m.avgCadence).toBeCloseTo(170, 5);
  });
  it('reports calories as unavailable rather than inventing a value', () => {
    expect(m.calories).toBeNull();
    expect(m.availability.calories.available).toBe(false);
    expect(formatMetric('calories', a, m, 'metric').value).toBe('–');
  });
});

describe('missing data', () => {
  it('no timestamps: distance yes, time/pace unavailable', () => {
    const a = load('no-time.gpx');
    const m = computeMetrics(a);
    expect(a.warnings.join(' ')).toMatch(/no timestamps/i);
    expect(m.distanceM).toBeGreaterThan(4900);
    expect(m.movingS).toBeNull();
    expect(m.avgPaceSPerKm).toBeNull();
    expect(m.availability.avgPace.available).toBe(false);
    expect(m.availability.movingTime.reason).toMatch(/timestamps/);
  });
  it('no elevation: elevation metrics unavailable', () => {
    const m = computeMetrics(load('no-elevation.gpx'));
    expect(m.elevGainM).toBeNull();
    expect(m.availability.elevGain.available).toBe(false);
    expect(m.avgHr).toBeNull();
  });
  it('route-only GPX imports with a warning', () => {
    const a = load('route-only.gpx');
    expect(a.warnings.join(' ')).toMatch(/planned route/);
    expect(computeMetrics(a).distanceM).toBeGreaterThan(4000);
  });
});

describe('errors', () => {
  const err = (name: string) => {
    try {
      load(name);
    } catch (e) {
      return e as ActivityImportError;
    }
    throw new Error('expected failure');
  };
  it('malformed XML', () => expect(err('malformed.gpx').code).toBe('malformed'));
  it('empty track', () => expect(err('empty-track.gpx').code).toBe('no_data'));
  it('unsupported content', () => expect(err('not-activity.gpx').code).toBe('unsupported_format'));
  it('empty file', () => {
    expect(() => parseActivity(new Uint8Array(), 'x.gpx', 'id')).toThrow(/empty/);
  });
});

describe('TCX import', () => {
  const a = load('straight-5k.tcx');
  const m = computeMetrics(a);
  it('uses device-recorded distance and lap totals', () => {
    expect(a.source.format).toBe('tcx');
    expect(m.distanceSource).toBe('device');
    expect(m.distanceM!).toBeCloseTo(5000, -1);
    expect(a.fileSummary.calories).toBe(360);
    expect(m.calories).toBe(360);
    expect(m.maxHr).toBe(150);
    expect(a.points[0].cad).toBe(170);
    expect(m.movingS!).toBeCloseTo(5000 / 3, -1);
  });
});

describe('FIT import', () => {
  const a = load('straight-5k.fit');
  const m = computeMetrics(a);
  it('decodes records, session summary and semicircle coordinates', () => {
    expect(a.source.format).toBe('fit');
    expect(a.points.length).toBeGreaterThan(300);
    expect(a.points[0].lat!).toBeCloseTo(13.73, 5);
    expect(a.points[0].lon!).toBeCloseTo(100.54, 5);
    expect(a.fileSummary.calories).toBe(360);
    expect(m.distanceM!).toBeCloseTo(5000, -1);
    expect(m.movingS!).toBeCloseTo(5000 / 3, -1);
    expect(a.points[0].cad).toBe(170);
  });
});

describe('overrides', () => {
  it('user edits take precedence without touching source data', () => {
    const a = load('straight-5k.gpx');
    a.overrides = { distanceM: 5100, name: 'Edited', calories: 400 };
    const m = computeMetrics(a);
    expect(m.distanceM).toBe(5100);
    expect(m.distanceSource).toBe('override');
    expect(formatMetric('name', a, m, 'metric').value).toBe('Edited');
    expect(a.name).toBe('Straight 5K');
    expect(m.calories).toBe(400);
  });
});

describe('formatting', () => {
  it('formats durations and paces', () => {
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatPace(299.6, 'metric')).toBe('5:00');
    expect(formatPace(300, 'imperial')).toBe('8:03');
  });
  it('imperial units', () => {
    const a = load('straight-5k.gpx');
    const m = computeMetrics(a);
    expect(formatMetric('distance', a, m, 'imperial')).toMatchObject({ value: '3.11', unit: 'mi' });
    expect(formatMetric('elevGain', a, m, 'imperial').unit).toBe('ft');
  });
  it('elevation hysteresis ignores noise', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 0.8 : -0.8));
    expect(elevationGainLoss(noisy).gain).toBe(0);
  });
});
