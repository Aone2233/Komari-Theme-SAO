import type { LoadRecord } from "@/types/komari";
import { formatBytes } from "@/utils/format";

export const TRAFFIC_UP_METRIC = "traffic.up";
export const TRAFFIC_DOWN_METRIC = "traffic.down";
export const RATE_UP_METRIC = "net.out.rate";
export const RATE_DOWN_METRIC = "net.in.rate";

export const TODAY_TRAFFIC_METRIC_KEYS = [
  TRAFFIC_UP_METRIC,
  TRAFFIC_DOWN_METRIC,
  RATE_UP_METRIC,
  RATE_DOWN_METRIC,
] as const;

export const TODAY_TRAFFIC_AGGREGATION = {
  [TRAFFIC_UP_METRIC]: "sum",
  [TRAFFIC_DOWN_METRIC]: "sum",
  [RATE_UP_METRIC]: "max",
  [RATE_DOWN_METRIC]: "max",
} as const;

export interface TrafficMetricSeries {
  metricKey: string;
  client: string;
  intervalSeconds?: number;
  semantics?: string;
  quality?: string;
  points: Array<{ time: string; value: number | null; count: number }>;
}

export interface TodayTrafficStat {
  uuid: string;
  trafficUp: number | null;
  trafficDown: number | null;
  trafficBasis: "validated-intervals" | "records-estimate" | "unavailable";
  peakUp: number;
  peakUpAt: number | null;
  peakDown: number;
  peakDownAt: number | null;
  sampleCount: number;
  hasSamples: boolean;
}

export interface TodayTrafficSample {
  timeMs: number;
  up: number;
  down: number;
}

function emptyStat(uuid: string): TodayTrafficStat {
  return {
    uuid,
    trafficUp: null,
    trafficDown: null,
    trafficBasis: "unavailable",
    peakUp: 0,
    peakUpAt: null,
    peakDown: 0,
    peakDownAt: null,
    sampleCount: 0,
    hasSamples: false,
  };
}

export function formatTodayTrafficAmount(value: number | null): string {
  return value == null ? "未知" : formatBytes(value);
}

export function todayTrafficTotal(stat: TodayTrafficStat): number | null {
  if (stat.trafficUp == null || stat.trafficDown == null) return null;
  const total = stat.trafficUp + stat.trafficDown;
  return Number.isSafeInteger(total) ? total : null;
}

export function aggregateTodayTraffic(stats: TodayTrafficStat[]) {
  const direction = (key: "trafficUp" | "trafficDown") => {
    if (stats.length === 0 || stats.some((stat) => stat[key] == null)) return null;
    const sum = stats.reduce((total, stat) => total + (stat[key] ?? 0), 0);
    return Number.isSafeInteger(sum) ? sum : null;
  };
  const up = direction("trafficUp");
  const down = direction("trafficDown");
  const total = up == null || down == null ? null : up + down;
  return { up, down, total: total != null && Number.isSafeInteger(total) ? total : null };
}

export function todayTrafficBasisLabel(stat: TodayTrafficStat): string {
  switch (stat.trafficBasis) {
    case "validated-intervals": return "已验证区间累计，可能不完整";
    case "records-estimate": return "历史采样估算，可能不完整";
    default: return "今日流量未知";
  }
}

function trafficDirectionKey(client: string, metricKey: string) {
  return client + "\u0000" + metricKey;
}

function validPoint(point: TrafficMetricSeries["points"][number]) {
  return point.count > 0 && point.value != null && Number.isFinite(point.value);
}

export function summarizeTodayTrafficMetrics(
  series: TrafficMetricSeries[],
  uuids: string[],
): TodayTrafficStat[] {
  const stats = new Map(uuids.map((uuid) => [uuid, emptyStat(uuid)] as const));
  const sampleTimes = new Map(uuids.map((uuid) => [uuid, new Set<number>()] as const));
  const trafficDirections = new Map<string, Array<TrafficMetricSeries>>();

  for (const item of series) {
    const stat = stats.get(item.client);
    if (!stat) continue;
    // The today number must stay unknown unless the backend answers each
    // traffic direction with one validated interval stream, from its first to
    // its last point: these are per-minute amounts, not cumulative counters.
    if (item.metricKey === TRAFFIC_UP_METRIC || item.metricKey === TRAFFIC_DOWN_METRIC) {
      const key = trafficDirectionKey(item.client, item.metricKey);
      const existing = trafficDirections.get(key) ?? [];
      existing.push(item);
      trafficDirections.set(key, existing);
      continue;
    }
    for (const point of item.points) {
      if (!validPoint(point)) continue;
      const timeMs = Date.parse(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const value = Math.max(0, point.value ?? 0);
      sampleTimes.get(item.client)?.add(timeMs);
      stat.hasSamples = true;

      switch (item.metricKey) {
        case RATE_UP_METRIC:
          if (value > stat.peakUp) {
            stat.peakUp = value;
            stat.peakUpAt = timeMs;
          }
          break;
        case RATE_DOWN_METRIC:
          if (value > stat.peakDown) {
            stat.peakDown = value;
            stat.peakDownAt = timeMs;
          }
          break;
      }
    }
  }

  for (const [uuid, stat] of stats) {
    for (const [metric, key] of [[TRAFFIC_UP_METRIC, "trafficUp"], [TRAFFIC_DOWN_METRIC, "trafficDown"]] as const) {
      const items = trafficDirections.get(trafficDirectionKey(uuid, metric)) ?? [];
      if (items.length !== 1 || items[0].semantics !== "interval_delta_v2") continue;
      const points = items[0].points;
      const valid = points.filter((point) => validPoint(point) && Number.isFinite(Date.parse(point.time)));
      if (valid.length === 0 || valid.length !== points.length || valid.some((point) =>
        !Number.isSafeInteger(point.value) || (point.value ?? -1) < 0,
      )) continue;
      const total = valid.reduce((sum, point) => sum + (point.value ?? 0), 0);
      if (!Number.isSafeInteger(total)) continue;
      stat[key] = total;
      stat.trafficBasis = "validated-intervals";
      stat.hasSamples = true;
      for (const point of valid) sampleTimes.get(uuid)?.add(Date.parse(point.time));
    }
    stat.sampleCount = sampleTimes.get(uuid)?.size ?? 0;
  }
  return [...stats.values()];
}

export function buildTodayTrafficMetricSamples(
  series: TrafficMetricSeries[],
  uuid: string,
): TodayTrafficSample[] {
  const samples = new Map<number, TodayTrafficSample>();
  for (const item of series) {
    if (
      item.client !== uuid ||
      (item.metricKey !== RATE_UP_METRIC && item.metricKey !== RATE_DOWN_METRIC)
    ) {
      continue;
    }
    for (const point of item.points) {
      if (!validPoint(point)) continue;
      const timeMs = Date.parse(point.time);
      if (!Number.isFinite(timeMs)) continue;
      const sample = samples.get(timeMs) ?? { timeMs, up: 0, down: 0 };
      if (item.metricKey === RATE_UP_METRIC) sample.up = Math.max(0, point.value ?? 0);
      else sample.down = Math.max(0, point.value ?? 0);
      samples.set(timeMs, sample);
    }
  }
  return [...samples.values()].sort((left, right) => right.timeMs - left.timeMs);
}

function recordTimeMs(record: LoadRecord) {
  if (typeof record.time === "number") {
    return record.time > 1_000_000_000_000 ? record.time : record.time * 1000;
  }
  return Date.parse(record.time);
}

export function summarizeTodayTrafficRecords(
  uuid: string,
  records: LoadRecord[],
  startMs: number,
  endMs: number,
): TodayTrafficStat {
  const stat = emptyStat(uuid);
  const sorted = records
    .map((record) => ({ record, timeMs: recordTimeMs(record) }))
    .filter(({ timeMs }) => Number.isFinite(timeMs) && timeMs <= endMs)
    .sort((left, right) => left.timeMs - right.timeMs);

  for (const item of sorted) {
    const { record, timeMs } = item;
    if (timeMs < startMs) continue;

    stat.hasSamples = true;
    stat.sampleCount += 1;
    // Legacy records do not prove whether these counters reset, wrapped or
    // crossed midnight, so keep traffic unknown while retaining rate samples.
    const netOut = Number.isFinite(record.net_out) ? record.net_out : 0;
    const netIn = Number.isFinite(record.net_in) ? record.net_in : 0;
    if (netOut > stat.peakUp) {
      stat.peakUp = Math.max(0, netOut);
      stat.peakUpAt = timeMs;
    }
    if (netIn > stat.peakDown) {
      stat.peakDown = Math.max(0, netIn);
      stat.peakDownAt = timeMs;
    }
  }

  return stat;
}

export function buildTodayTrafficRecordSamples(
  records: LoadRecord[],
  startMs: number,
  endMs: number,
): TodayTrafficSample[] {
  return records
    .map((record) => ({ record, timeMs: recordTimeMs(record) }))
    .filter(
      ({ timeMs }) => Number.isFinite(timeMs) && timeMs >= startMs && timeMs <= endMs,
    )
    .map(({ record, timeMs }) => ({
      timeMs,
      up: Math.max(0, Number.isFinite(record.net_out) ? record.net_out : 0),
      down: Math.max(0, Number.isFinite(record.net_in) ? record.net_in : 0),
    }))
    .sort((left, right) => right.timeMs - left.timeMs);
}
