import type { FullTextAnalysisInput } from "../../application/analyze/ports/full-text-analysis.port";
import type {
	SnippetEvidence,
	SnippetVerifyInput,
} from "../../application/analyze/ports/snippet-judgement.port";
import { CONTENT_TYPES } from "../../domain/analyze/content-type";
import { SENTIMENTS } from "../../domain/analyze/sentiment";
import { brandLines } from "./anthropic-structured";

/** "Known look-alikes" framing for the verbatim negativeBoost (ADR 0001), or a no-collisions note. */
function lookAlikes(negativeBoost: string): string {
	return negativeBoost
		? `Known look-alikes sharing this name that are NOT the target — reject pages about these:\n${negativeBoost}`
		: "No known look-alikes were provided.";
}

/** snippet-Verify (Pass 1a): title+snippet+URL only → a single 0-100 entity-match score. */
export function snippetVerifyPrompt(input: SnippetVerifyInput): string {
	return [
		"You judge how confident we are that a search result is about the TARGET company.",
		"Target company brand context:",
		brandLines(input.brandContext),
		lookAlikes(input.negativeBoost),
		"Search result evidence (title, snippet, URL only):",
		`Title: ${input.evidence.title}`,
		`Snippet: ${input.evidence.snippet}`,
		`URL: ${input.evidence.url}`,
		'Respond ONLY with JSON: {"entityMatchScore": <integer 0-100>}.',
	].join("\n");
}

/** snippet-Classify (Pass 1b): title+snippet+URL only → a provisional Content Type. */
export function snippetClassifyPrompt(evidence: SnippetEvidence): string {
	return [
		"Classify the search result's content type from its title, snippet, and URL.",
		`Allowed types: ${CONTENT_TYPES.join(", ")}.`,
		`Title: ${evidence.title}`,
		`Snippet: ${evidence.snippet}`,
		`URL: ${evidence.url}`,
		'Respond ONLY with JSON: {"contentType": "<one allowed type>"}.',
	].join("\n");
}

/** The fused full-text call (Pass 2, ADR 0003): all four outputs from the Extracted page text. */
export function fullTextPrompt(input: FullTextAnalysisInput): string {
	return [
		"Read the full page text and judge it against the TARGET company. Return all four fields together.",
		"Target company brand context:",
		brandLines(input.brandContext),
		lookAlikes(input.negativeBoost),
		"Full page text:",
		input.fullText,
		"Respond ONLY with JSON of the shape:",
		`{"entityMatchScore": <integer 0-100>, "contentType": "<one of: ${CONTENT_TYPES.join(", ")}>", "sentiment": "<one of: ${SENTIMENTS.join(", ")}>", "takeaway": "<short takeaway about the target>"}`,
	].join("\n");
}
