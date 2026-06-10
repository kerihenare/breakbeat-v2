import type { CollisionContext } from "./brand-context";

/**
 * NameCollision — a different company sharing the target's name (CONTEXT.md
 * "Name Collision"). It exists to be *contrasted against*, never confused with
 * the target. `context` is null when its /v2/context call failed (a Warning).
 */
export type NameCollision = {
	readonly brandId: string | null;
	readonly domain: string;
	readonly name: string;
	readonly context: CollisionContext | null;
};
