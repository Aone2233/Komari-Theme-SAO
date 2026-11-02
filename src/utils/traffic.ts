// 与后端 computeUsedByType 保持一致，空或未知类型按 max 处理。
export interface TrafficDisplay {
  fraction: number | null;
  color: string;
  remainingLabel: string;
  detail: string;
  typeLabel: string;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 按节点的 `traffic_limit_type` 从累计上/下行总量算出已用流量。默认(空/未知)为 "max",与后端一致。
 */
export function computeTrafficUsed(
  type: string | null | undefined,
  up: number,
  down: number,
): number {
  const safeUp = nonNegative(up);
  const safeDown = nonNegative(down);
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return safeUp;
    case "down":
      return safeDown;
    case "sum":
      return safeUp + safeDown;
    case "min":
      return Math.min(safeUp, safeDown);
    case "max":
    default:
      return Math.max(safeUp, safeDown);
  }
}

interface TrafficUsage {
  used: number;
  limit: number;
  unlimited: boolean;
  remaining: number;
  fraction: number;
}

// 首页卡片与实例详情共用同一归约口径。
export function resolveTrafficUsage(
  type: string | null | undefined,
  up: number,
  down: number,
  limit: number,
): TrafficUsage;
export function resolveTrafficUsage(
  type: string | null | undefined,
  up: number | null,
  down: number | null,
  limit: number,
): TrafficUsage | null;
export function resolveTrafficUsage(
  type: string | null | undefined,
  up: number | null,
  down: number | null,
  limit: number,
): TrafficUsage | null {
  const mode = (type ?? "").trim().toLowerCase();
  const valid = (value: number | null) => value != null && Number.isSafeInteger(value) && value >= 0;
  if ((mode !== "down" && !valid(up)) || (mode !== "up" && !valid(down))) return null;
  const used = computeTrafficUsed(type, up ?? 0, down ?? 0);
  if (!Number.isSafeInteger(used) || used < 0) return null;
  const unlimited = !(limit > 0);
  const remaining = unlimited ? 0 : Math.max(0, limit - used);
  const fraction = unlimited ? 0 : Math.max(0, Math.min(1, used / limit));
  return { used, limit, unlimited, remaining, fraction };
}

export function trafficTypeLabel(type: string | null | undefined): string {
  switch ((type ?? "").trim().toLowerCase()) {
    case "up":
      return "仅上行";
    case "down":
      return "仅下行";
    case "sum":
      return "上行+下行";
    case "min":
      return "上下取小";
    case "max":
    default:
      return "上下取大";
  }
}
