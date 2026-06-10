/** Stance toward the TARGET company — not the article's overall mood. */
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
