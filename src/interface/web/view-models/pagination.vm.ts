/** Pagination range maths (PRD 7). Pure — no I/O. */
export interface PageView {
	readonly page: number;
	readonly pageSize: number;
	readonly total: number;
	readonly totalPages: number;
	readonly hasPrev: boolean;
	readonly hasNext: boolean;
	readonly from: number;
	readonly to: number;
}

export function paginate(
	total: number,
	requestedPage: number,
	pageSize: number,
): PageView {
	const safeSize = Math.max(1, Math.trunc(pageSize));
	const totalPages = Math.max(1, Math.ceil(total / safeSize));
	const page = Math.min(
		Math.max(1, Math.trunc(requestedPage) || 1),
		totalPages,
	);
	const from = total === 0 ? 0 : (page - 1) * safeSize + 1;
	const to = Math.min(page * safeSize, total);
	return {
		from,
		hasNext: page < totalPages,
		hasPrev: page > 1,
		page,
		pageSize: safeSize,
		to,
		total,
		totalPages,
	};
}
