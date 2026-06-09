# The post-Extract full-text pass is a single Haiku call

## Status

accepted

## Context

After Tavily Extracts a Result's full page text, three logically-distinct things need to happen on that text: **re-verify** entity relevance (catch look-alikes whose snippet fooled the cheap Verify gate, and set the final Match Score), **re-classify** content type, and **enhance** (sentiment toward the target + a short takeaway). The pipeline models Verify, Classify, and Enhance as separate stages, so the obvious implementation is three separate LLM calls per extracted Result.

## Decision

The post-Extract full-text work is **one Haiku call per extracted Result**, returning `{entity-match score, content-type, sentiment, takeaway}` together. The cheap, pre-Extract snippet gates stay separate (snippet-Verify drops obvious off-topic and sets a provisional/interim Match Score; snippet-Classify), and Extract only runs for their survivors.

This also makes **Verify two-pass** — a snippet gate before Extract and a full-text re-pass after — symmetric to Classify, closing a precision leak where a snippet-fooling look-alike (HomeAglow funding, Aglow Air) was never re-checked against the page we already paid to Extract.

## Why

- The three concerns all read the *same* extracted text at the *same* point in the pipeline; one call is ~3× cheaper and lower-latency than three.
- It plugs the confusable-indexed-brand precision leak for free — the evidence to catch the mismatch is already in hand.

## Consequences

- Verify, Classify, and Enhance remain **distinct domain stages** (separate fields, separate `verification_status` / content-type / sentiment); only their *full-text execution* is fused into one call. Do not "separate concerns" by splitting this back into three calls — the fusion is deliberate and the cost saving is the point.
- A Result can be Excluded `off_topic` at the full-text re-pass *after* having been snippet-classified; that's fine (an Excluded row keeping a content type is harmless).
