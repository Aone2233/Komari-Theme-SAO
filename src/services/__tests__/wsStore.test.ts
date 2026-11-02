import { describe, expect, it } from "vitest";
import { cycleTrafficFromLatest, resolveFlatConnectionsTcp, resolveTrafficTotal } from "@/services/wsStore";

describe("cycleTrafficFromLatest", () => {
  it("uses the explicitly valid cycle rather than kernel totals, including a zero rollover", () => {
    expect(cycleTrafficFromLatest({ quality: { traffic_cycle: "ok" }, traffic_up: 0, traffic_down: 5, net_total_up: 500, net_total_down: 600 }))
      .toEqual({ up: 0, down: 5 });
  });

  it("does not fall back to kernel totals for missing, legacy or failed quality", () => {
    for (const quality of [undefined, {}, { traffic_cycle: "unknown" }]) {
      expect(cycleTrafficFromLatest({ quality, traffic_up: 10, traffic_down: 20, net_total_up: 500 }))
        .toEqual({ up: null, down: null });
    }
    expect(cycleTrafficFromLatest(null)).toEqual({ up: null, down: null });
  });

  it("keeps invalid or missing directions unknown", () => {
    expect(cycleTrafficFromLatest({ quality: { traffic_cycle: "ok" }, traffic_up: null, traffic_down: 20 }))
      .toEqual({ up: null, down: 20 });
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "0"]) {
      expect(cycleTrafficFromLatest({ quality: { traffic_cycle: "ok" }, traffic_up: value }).up).toBeNull();
    }
  });
});

// 像 resolveTrafficTotals 每个 tick 那样,把一串原始累计读数喂给 resolver:把上一个显示值
//(store 存在 node metrics 上)往后传。
function drive(readings: number[]): number[] {
  let previous = 0;
  return readings.map((raw) => {
    previous = resolveTrafficTotal(previous, raw);
    return previous;
  });
}

describe("resolveTrafficTotal", () => {
  it("passes the backend counter through unchanged while it climbs", () => {
    expect(drive([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("holds the previous value when a tick reports zero (missing/partial sample)", () => {
    // 读到 0 是 offline/heartbeat 帧或漏了 net_total_up/down 的 payload,不是真实流量。
    // 保持上一个值能避免闪烁到 0,也(这正是我们要防的回归)避免真实读数回来时重复抬高总量:
    // 概览以前每次 offline 抖动都会大致翻倍。
    expect(drive([50, 0, 51])).toEqual([50, 50, 51]);
  });

  it("stays stable across repeated zero readings", () => {
    expect(drive([50, 0, 0, 51, 0, 52])).toEqual([50, 50, 50, 51, 51, 52]);
  });

  it("follows a genuine counter reset down (reboot / billing-cycle rollover)", () => {
    // 后端计数器合理下降;我们如实透传,让概览和流量限额条跟随后端而不是停在虚高值。
    expect(drive([50, 5, 6])).toEqual([50, 5, 6]);
  });

  it("ignores a zero gap but still follows a later real reset", () => {
    // 50 → offline(0,保持)→ 重置后带一个小的真实计数回来。
    expect(drive([50, 0, 2, 3])).toEqual([50, 50, 2, 3]);
  });

  it("does not surface a value until a real reading arrives", () => {
    expect(drive([0, 0, 10])).toEqual([0, 0, 10]);
  });
});

describe("resolveFlatConnectionsTcp", () => {
  it("derives TCP as connections − udp (latest-status sends TCP+UDP combined)", () => {
    expect(resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5 })).toBe(7);
  });

  it("prefers an explicit connections_tcp when present", () => {
    expect(
      resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5, connections_tcp: 9 }),
    ).toBe(9);
  });

  it("clamps to 0 when udp exceeds the combined count", () => {
    expect(resolveFlatConnectionsTcp({ connections: 3, connections_udp: 5 })).toBe(0);
  });
});
