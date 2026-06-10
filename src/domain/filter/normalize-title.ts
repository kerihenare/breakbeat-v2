// Separators wire re-prints use to append a publisher tail (em dash, en dash, pipe, hyphen).
const SUFFIX_SEPARATORS = [" — ", " – ", " | ", " - "];

/**
 * The single shared "same title" key: lowercase, collapse whitespace, strip surrounding
 * punctuation, and drop a trailing source/site suffix (a SHORT tail after the last known
 * separator — a publisher name, not a meaningful clause). Defined once; shared by all tests.
 */
export function normalizeTitle(title: string): string {
	let head = title.trim();
	for (const sep of SUFFIX_SEPARATORS) {
		const idx = head.lastIndexOf(sep);
		if (idx > 0) {
			const tail = head.slice(idx + sep.length).trim();
			if (tail.split(/\s+/).length <= 6) head = head.slice(0, idx);
			break;
		}
	}
	return head
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}
