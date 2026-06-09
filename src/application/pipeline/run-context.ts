import type { ResolvedIdentity } from "../../domain/identity/resolved-identity";
import type { Job } from "../../domain/job/job";
import type { Warning } from "../../domain/job/warning";

/**
 * Shared run state threaded through the ordered stages by the StageRunner.
 *
 * A concrete class (not a bare object) so it is open to the extension points
 * later PRDs depend on. The `resolvedIdentity` slot is reserved for PRD 2:
 * Resolve calls `setResolvedIdentity` (set-once), and Search/Verify read it —
 * later stages thread shared state without reshaping the runner.
 *
 * `recordWarning` delegates to the Job aggregate, which owns the single warning
 * list — there is never a second list to reconcile.
 */
export class RunContext {
	private resolved: ResolvedIdentity | undefined;

	constructor(readonly job: Job) {}

	recordWarning(warning: Warning): void {
		this.job.recordWarning(warning);
	}

	get resolvedIdentity(): ResolvedIdentity | undefined {
		return this.resolved;
	}

	/** Reserved for PRD 2. Set-once per Job run; a second call is a programming error. */
	setResolvedIdentity(identity: ResolvedIdentity): void {
		if (this.resolved !== undefined) {
			throw new Error("ResolvedIdentity is set once per Job run");
		}
		this.resolved = identity;
	}
}
