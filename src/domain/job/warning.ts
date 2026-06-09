/**
 * Warning — a recorded note that a stage completed its purpose PARTIALLY
 * (CONTEXT.md "Warning"). It is a partial *success*, never an error. The
 * presence of any Warning at completion turns `done` into `done_with_warnings`.
 */
export interface Warning {
	readonly type: string;
	readonly message: string;
}

export function warning(type: string, message: string): Warning {
	return Object.freeze({ message, type });
}
