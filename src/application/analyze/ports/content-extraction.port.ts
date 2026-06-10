/** Tavily Extract (server-side); we never "fetch" a Result page. */
export type ExtractionResult =
	| { readonly kind: "extracted"; readonly fullText: string }
	| { readonly kind: "extractionFailure" };

export interface ContentExtractionPort {
	/** Never throws — failure → { kind: "extractionFailure" }. */
	extract(url: string): Promise<ExtractionResult>;
}

export const CONTENT_EXTRACTION_PORT = Symbol("ContentExtractionPort");
