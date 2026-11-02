import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeInfoSchema } from "@/types/komari";

const { getNodes, getNodesLatestStatus } = vi.hoisted(() => ({
  getNodes: vi.fn(),
  getNodesLatestStatus: vi.fn(),
}));

vi.mock("@/services/api", () => ({ getNodes, getNodesLatestStatus }));

describe("cycle traffic during the initial status bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout, clearTimeout, setInterval, clearInterval,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    getNodes.mockReset();
    getNodesLatestStatus.mockReset();
    getNodes.mockResolvedValue([NodeInfoSchema.parse({ uuid: "synthetic" })]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    [{ quality: { traffic_cycle: "ok" }, traffic_up: 0, traffic_down: 37 }, 0, 37],
    [{ quality: { traffic_cycle: "unknown" }, traffic_up: 10, traffic_down: 20 }, null, null],
  ])("hydrates only validated cycle counters on the first snapshot", async (record, up, down) => {
    getNodesLatestStatus.mockResolvedValue({ synthetic: { ...record, online: true } });
    const store = await import("@/services/wsStore");
    const release = store.retainStore();
    await vi.waitFor(() => expect(store.getStoreStatusSnapshot().hydrated).toBe(true));
    expect(store.getNodeMetricsSnapshot("synthetic")).toMatchObject({ cycleUp: up, cycleDown: down });
    expect(getNodesLatestStatus).toHaveBeenCalledTimes(1);
    release();
    vi.runOnlyPendingTimers();
  });

  it("refreshes retained metrics from the initial snapshot after the store restarts", async () => {
    getNodesLatestStatus.mockResolvedValueOnce({
      synthetic: { online: true, quality: { traffic_cycle: "ok" }, traffic_up: 10, traffic_down: 20 },
    });
    const store = await import("@/services/wsStore");
    const release = store.retainStore();
    await vi.waitFor(() => expect(store.getStoreStatusSnapshot().hydrated).toBe(true));
    expect(store.getNodeMetricsSnapshot("synthetic")).toMatchObject({ cycleUp: 10, cycleDown: 20 });
    release();
    vi.advanceTimersByTime(0);

    getNodesLatestStatus.mockResolvedValueOnce({
      synthetic: { online: true, quality: { traffic_cycle: "ok" }, traffic_up: 30, traffic_down: 40 },
    });
    const releaseAgain = store.retainStore();
    await vi.waitFor(() => expect(getNodesLatestStatus).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getStoreStatusSnapshot().hydrated).toBe(true));
    expect(store.getNodeMetricsSnapshot("synthetic")).toMatchObject({ cycleUp: 30, cycleDown: 40 });
    releaseAgain();
    vi.advanceTimersByTime(0);
  });

  it("does not keep a stale cycle if a successful restart snapshot omits the node", async () => {
    getNodesLatestStatus.mockResolvedValueOnce({
      synthetic: { online: true, quality: { traffic_cycle: "ok" }, traffic_up: 10, traffic_down: 20 },
    });
    const store = await import("@/services/wsStore");
    const release = store.retainStore();
    await vi.waitFor(() => expect(store.getStoreStatusSnapshot().hydrated).toBe(true));
    release();
    vi.advanceTimersByTime(0);

    getNodesLatestStatus.mockResolvedValueOnce({});
    const releaseAgain = store.retainStore();
    await vi.waitFor(() => expect(getNodesLatestStatus).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.getStoreStatusSnapshot().hydrated).toBe(true));
    expect(store.getNodeMetricsSnapshot("synthetic")).toMatchObject({
      online: false, cycleUp: null, cycleDown: null,
    });
    releaseAgain();
    vi.advanceTimersByTime(0);
  });
});
