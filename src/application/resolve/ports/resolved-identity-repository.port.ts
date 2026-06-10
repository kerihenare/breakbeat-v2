import type { ResolvedIdentity } from "../../../domain/resolve/resolved-identity";

/** Persists one Resolved Identity per Job (durable; PRD 7 read model). */
export interface ResolvedIdentityRepository {
	save(jobId: string, identity: ResolvedIdentity): Promise<void>;
	findByJobId(jobId: string): Promise<ResolvedIdentity | null>;
}

export const RESOLVED_IDENTITY_REPOSITORY = Symbol(
	"ResolvedIdentityRepository",
);
