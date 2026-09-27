import { describe, expect, it } from "vitest";
import type { Context, Model } from "@earendil-works/pi-ai";
import { resolveWorkerStreamSimple, type WorkerStreamSimple } from "./worker-stream.js";

describe("resolveWorkerStreamSimple", () => {
	it("keeps the registry receiver when using a prototype streamSimple", () => {
		const sentinel = {} as ReturnType<WorkerStreamSimple>;
		class Registry {
			runtime = { streamSimple: () => sentinel };
			streamSimple(model: Model<any>, context: Context) {
				return this.runtime.streamSimple();
			}
		}
		const model = { provider: "p", api: "a" } as Model<any>;
		const stream = resolveWorkerStreamSimple(model, new Registry());
		expect(stream(model, { messages: [] })).toBe(sentinel);
	});
});
