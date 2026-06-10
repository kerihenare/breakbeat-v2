import { eq } from "drizzle-orm";
import type { ResolvedIdentityRepository } from "../../application/resolve/ports/resolved-identity-repository.port";
import type { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import type { Database } from "./database";
import { identityToRows, rowsToIdentity } from "./resolved-identity.mapper";
import {
	resolvedIdentities,
	resolvedIdentityCollisions,
	resolvedIdentityHandles,
	resolvedIdentityOwnDomains,
} from "./schema";

/**
 * Drizzle adapter for the ResolvedIdentityRepository port. `save` writes the
 * parent row plus its own-domain / handle / collision children in one
 * transaction; `findByJobId` reconstitutes a ResolvedIdentity via the mapper.
 * The JSONB columns hold Zod-validated structured output only — never raw
 * payloads or scraped HTML (anti-echo). A re-run is a new Job id with its own
 * rows; the repository never mutates a prior Job's identity.
 */
export class ResolvedIdentityDrizzleRepository
	implements ResolvedIdentityRepository
{
	constructor(private readonly db: Database) {}

	async save(jobId: string, identity: ResolvedIdentity): Promise<void> {
		const rows = identityToRows(jobId, identity);
		await this.db.transaction(async (tx) => {
			await tx.insert(resolvedIdentities).values(rows.parent);
			if (rows.ownDomains.length > 0) {
				await tx.insert(resolvedIdentityOwnDomains).values(rows.ownDomains);
			}
			if (rows.handles.length > 0) {
				await tx.insert(resolvedIdentityHandles).values(rows.handles);
			}
			if (rows.collisions.length > 0) {
				await tx.insert(resolvedIdentityCollisions).values(rows.collisions);
			}
		});
	}

	async findByJobId(jobId: string): Promise<ResolvedIdentity | null> {
		const [parent] = await this.db
			.select()
			.from(resolvedIdentities)
			.where(eq(resolvedIdentities.jobId, jobId))
			.limit(1);
		if (!parent) return null;
		const [domains, handles, collisions] = await Promise.all([
			this.db
				.select()
				.from(resolvedIdentityOwnDomains)
				.where(eq(resolvedIdentityOwnDomains.jobId, jobId))
				.orderBy(resolvedIdentityOwnDomains.id),
			this.db
				.select()
				.from(resolvedIdentityHandles)
				.where(eq(resolvedIdentityHandles.jobId, jobId))
				.orderBy(resolvedIdentityHandles.id),
			this.db
				.select()
				.from(resolvedIdentityCollisions)
				.where(eq(resolvedIdentityCollisions.jobId, jobId))
				.orderBy(resolvedIdentityCollisions.id),
		]);
		return rowsToIdentity(parent, domains, handles, collisions);
	}
}
