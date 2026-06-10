import type { NameCollision } from "./name-collision";

const HEADER =
	"Known look-alikes sharing this name that are NOT the target — reject pages about these:";

/**
 * ADR 0001: the Negative Boost is the collisions' own Brand Contexts *collected*
 * into a compact one-line-per-look-alike list — NOT pre-computed per-collision
 * diffs. Pure, synchronous, no LLM, no injected dependency. Zero Resolve-time
 * LLM cost is a structural property of this signature.
 */
export function deriveNegativeBoost(
	collisions: readonly NameCollision[],
): string {
	if (collisions.length === 0) return "";
	const lines = collisions.map((c) => {
		const head = `- ${c.name} (${c.domain})`;
		if (!c.context) return head;
		const gist = c.context.valueProposition ?? c.context.description ?? "";
		const offers = c.context.productsAndServices.length
			? `; offers ${c.context.productsAndServices.join(", ")}`
			: "";
		const aud = c.context.targetAudienceSegments.length
			? `; for ${c.context.targetAudienceSegments.join(", ")}`
			: "";
		return `${head}: ${gist}${offers}${aud}`;
	});
	return `${HEADER}\n${lines.join("\n")}`;
}
