import { describe, expect, it } from "vitest";
import type { LoadRecord } from "@/types/komari";
import {
  aggregateTodayTraffic,
  buildTodayTrafficMetricSamples,
  buildTodayTrafficRecordSamples,
  formatTodayTrafficAmount,
  RATE_DOWN_METRIC,
  RATE_UP_METRIC,
  summarizeTodayTrafficMetrics,
  summarizeTodayTrafficRecords,
  todayTrafficBasisLabel,
  todayTrafficTotal,
  TRAFFIC_DOWN_METRIC,
  TRAFFIC_UP_METRIC,
  type TrafficMetricSeries,
} from "@/utils/trafficStats";

function metricSeries(
  metricKey: string,
  values: Array<[string, number | null, number?]>,
  extras: Partial<TrafficMetricSeries> = {},
): TrafficMetricSeries {
  return {
    metricKey,
    client: "node-a",
    intervalSeconds: 300,
    points: values.map(([time, value, count = 1]) => ({ time, value, count })),
    ...extras,
  };
}

function record(time: string, overrides: Partial<LoadRecord> = {}): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: 0,
    swap: 0,
    swap_total: 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    client: "node-a",
    time,
    ...overrides,
  };
}

const validated: Partial<TrafficMetricSeries> = {
  semantics: "interval_delta_v2",
  quality: "validated_intervals_only;legacy_history_unknown",
};

describe("summarizeTodayTrafficMetrics", () => {
  it("sums both validated interval directions and keeps rate peaks", () => {
    const stats = summarizeTodayTrafficMetrics(
      [
        metricSeries(TRAFFIC_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 100],
          ["2026-07-16T00:05:00Z", 50],
        ], validated),
        metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 300]], validated),
        metricSeries(RATE_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", 25],
        ]),
        metricSeries(RATE_DOWN_METRIC, [
          ["2026-07-16T00:00:00Z", 40],
          ["2026-07-16T00:05:00Z", 30],
        ]),
      ],
      ["node-a", "node-b"],
    );

    expect(stats[0]).toMatchObject({
      trafficUp: 150,
      trafficDown: 300,
      trafficBasis: "validated-intervals",
      peakUp: 25,
      peakUpAt: Date.parse("2026-07-16T00:05:00Z"),
      peakDown: 40,
      peakDownAt: Date.parse("2026-07-16T00:00:00Z"),
      sampleCount: 2,
      hasSamples: true,
    });
    expect(stats[1]).toMatchObject({
      uuid: "node-b",
      trafficUp: null,
      trafficDown: null,
      trafficBasis: "unavailable",
      hasSamples: false,
      sampleCount: 0,
    });
  });

  it("treats cumulative, unlabelled, duplicate, empty and invalid series as unknown, not zero", () => {
    const cases: TrafficMetricSeries[] = [
      metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", 100]], {
        semantics: "billing_cycle_cumulative",
      }),
      metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 20]]),
      metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", 0]], {
        semantics: "billing_cycle_cumulative",
      }),
      metricSeries(TRAFFIC_DOWN_METRIC, [], validated),
      metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", -5]], validated),
      metricSeries(TRAFFIC_UP_METRIC, [["not-a-date", 10]], validated),
    ];
    for (const series of cases) {
      const stat = summarizeTodayTrafficMetrics([series], ["node-a"])[0];
      expect(stat.trafficUp).toBeNull();
      expect(stat.trafficDown).toBeNull();
      expect(stat.trafficBasis).toBe("unavailable");
    }

    const duplicate = summarizeTodayTrafficMetrics(
      [
        metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", 10]], validated),
        metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", 20]], validated),
        metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 30]], validated),
      ],
      ["node-a"],
    )[0];
    expect(duplicate.trafficUp).toBeNull();
    expect(duplicate.trafficDown).toBe(30);

    const partialPoints = summarizeTodayTrafficMetrics(
      [
        metricSeries(TRAFFIC_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", null],
          ["2026-07-16T00:10:00Z", 30],
        ], validated),
        metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 5]], validated),
      ],
      ["node-a"],
    )[0];
    expect(partialPoints.trafficUp).toBeNull();
    expect(partialPoints.trafficDown).toBe(5);
  });

  it("preserves a genuinely validated zero and treats a lone direction as unknown", () => {
    const stats = summarizeTodayTrafficMetrics(
      [
        metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", 0]], validated),
        metricSeries(TRAFFIC_DOWN_METRIC, [["2026-07-16T00:00:00Z", 0]], validated),
      ],
      ["node-a"],
    );
    expect(stats[0]).toMatchObject({
      trafficUp: 0,
      trafficDown: 0,
      trafficBasis: "validated-intervals",
      hasSamples: true,
      sampleCount: 1,
    });

    const lone = summarizeTodayTrafficMetrics(
      [metricSeries(TRAFFIC_UP_METRIC, [["2026-07-16T00:00:00Z", 7]], validated)],
      ["node-a"],
    )[0];
    expect(lone).toMatchObject({ trafficUp: 7, trafficDown: null, trafficBasis: "validated-intervals", hasSamples: true });
  });
});

describe("aggregateTodayTraffic and formatting", () => {
  const base = {
    peakUp: 0,
    peakUpAt: null,
    peakDown: 0,
    peakDownAt: null,
    sampleCount: 0,
    hasSamples: false,
  };

  it("only aggregates when every node and direction is known", () => {
    const totals = aggregateTodayTraffic([
      { uuid: "a", trafficUp: 10, trafficDown: 20, trafficBasis: "validated-intervals", ...base },
      { uuid: "b", trafficUp: 30, trafficDown: 40, trafficBasis: "validated-intervals", ...base },
    ]);
    expect(totals).toEqual({ up: 40, down: 60, total: 100 });

    const partial = aggregateTodayTraffic([
      { uuid: "a", trafficUp: 10, trafficDown: 20, trafficBasis: "validated-intervals", ...base },
      { uuid: "b", trafficUp: null, trafficDown: 40, trafficBasis: "unavailable", ...base },
    ]);
    expect(partial).toEqual({ up: null, down: 60, total: null });
  });

  it("formats unknown distinctly from zero", () => {
    expect(formatTodayTrafficAmount(0)).toBe("0 B");
    expect(formatTodayTrafficAmount(null)).toBe("未知");
    expect(todayTrafficTotal({
      uuid: "a", trafficUp: null, trafficDown: 3, trafficBasis: "unavailable", ...base,
    })).toBeNull();
    expect(todayTrafficBasisLabel({
      uuid: "a", trafficUp: 1, trafficDown: 2, trafficBasis: "validated-intervals", ...base,
    })).toBe("已验证区间累计，可能不完整");
    expect(todayTrafficBasisLabel({
      uuid: "a", trafficUp: null, trafficDown: null, trafficBasis: "records-estimate", ...base,
    })).toBe("历史采样估算，可能不完整");
  });
});

describe("records path", () => {
  const start = Date.parse("2026-07-16T00:00:00Z");
  const end = Date.parse("2026-07-16T01:00:00Z");

  it("keeps traffic unknown on legacy records without inventing midnight deltas", () => {
    const stats = summarizeTodayTrafficRecords(
      "node-a",
      [
        record("2026-07-15T23:55:00Z", { net_total_up: 100, net_total_down: 200 }),
        record("2026-07-16T00:05:00Z", {
          net_total_up: 150,
          net_total_down: 260,
          net_out: 12,
          net_in: 24,
        }),
      ],
      start,
      end,
    );
    expect(stats).toMatchObject({
      trafficUp: null,
      trafficDown: null,
      trafficBasis: "unavailable",
      peakUp: 12,
      peakDown: 24,
      sampleCount: 1,
      hasSamples: true,
    });
  });

  it("still builds rate samples and keeps record traffic out of the daily total", () => {
    const stats = summarizeTodayTrafficRecords(
      "node-a",
      [record("2026-07-16T00:05:00Z", { net_out: 3, net_in: 4 })],
      start,
      end,
    );
    expect(stats.trafficUp).toBeNull();
    expect(stats.trafficDown).toBeNull();
    expect(stats.hasSamples).toBe(true);
    expect(todayTrafficTotal(stats)).toBeNull();
  });

  it("keeps sample windows inside the requested range", () => {
    const samples = buildTodayTrafficRecordSamples(
      [
        record("2026-07-15T23:55:00Z", { net_out: 1, net_in: 2 }),
        record("2026-07-16T00:05:00Z", { net_out: 3, net_in: 4 }),
      ],
      start,
      end,
    );
    expect(samples).toEqual([{ timeMs: Date.parse("2026-07-16T00:05:00Z"), up: 3, down: 4 }]);
  });
});

describe("rate samples", () => {
  it("builds newest-first upload and download samples for the detail table", () => {
    const metricSamples = buildTodayTrafficMetricSamples(
      [
        metricSeries(RATE_UP_METRIC, [
          ["2026-07-16T00:00:00Z", 10],
          ["2026-07-16T00:05:00Z", 20],
        ]),
        metricSeries(RATE_DOWN_METRIC, [
          ["2026-07-16T00:00:00Z", 30],
          ["2026-07-16T00:05:00Z", 40],
        ]),
      ],
      "node-a",
    );
    expect(metricSamples).toEqual([
      { timeMs: Date.parse("2026-07-16T00:05:00Z"), up: 20, down: 40 },
      { timeMs: Date.parse("2026-07-16T00:00:00Z"), up: 10, down: 30 },
    ]);
  });

  it("does not assign a pseudo peak timestamp when every rate sample is zero", () => {
    const stat = summarizeTodayTrafficMetrics(
      [
        metricSeries(RATE_UP_METRIC, [["2026-07-16T00:05:00Z", 0]]),
        metricSeries(RATE_DOWN_METRIC, [["2026-07-16T00:05:00Z", 0]]),
      ],
      ["node-a"],
    )[0];
    expect(stat).toMatchObject({ peakUp: 0, peakUpAt: null, peakDown: 0, peakDownAt: null });
  });
});
