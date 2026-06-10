interface StreamFrame {
	count: number;
	isTerminal: boolean;
	listHtml: string;
	statusHtml: string;
}

const ENTRANCE_MS = 180;

/**
 * `<bb-result-stream>` — the live Result list island (ADR 0006/0007).
 *
 * A plain custom element (not Lit): it owns no template of its own, it mutates
 * the server-rendered `#results-list` and `#job-status-badge` that live OUTSIDE
 * it, so a templating framework would only get in the way (and would clobber the
 * server-rendered region it wraps).
 *
 * It opens an `EventSource` to `GET /jobs/:id/stream` and on each `snapshot`
 * frame: always refreshes the status badge; refreshes the list ONLY on an
 * unfiltered page-1 view (page-1-only scope — a filtered or page-2+ view is a
 * static snapshot); announces the running count to a polite live region; and
 * closes the stream at the terminal state. Under prefers-reduced-motion the
 * entrance flourish is skipped. The page works fully without this island.
 */
class BbResultStream extends HTMLElement {
	private source: EventSource | null = null;
	private readonly live = document.createElement("div");

	connectedCallback(): void {
		const jobId = this.dataset.jobId;
		if (!jobId) return;
		this.live.setAttribute("aria-live", "polite");
		this.live.className = "sr-only";
		this.appendChild(this.live);

		this.source = new EventSource(`/jobs/${jobId}/stream`);
		this.source.addEventListener("snapshot", (event) =>
			this.onSnapshot(event as MessageEvent),
		);
		// On error the browser auto-reconnects; nothing to do.
	}

	disconnectedCallback(): void {
		this.source?.close();
		this.source = null;
	}

	private onSnapshot(event: MessageEvent): void {
		let frame: StreamFrame;
		try {
			frame = JSON.parse(event.data as string) as StreamFrame;
		} catch {
			return;
		}

		// statusHtml/listHtml are server-rendered by nunjucks with autoescape ON
		// (titles etc. are already entity-escaped) — trusted markup, not raw input.
		const badge = document.getElementById("job-status-badge");
		if (badge) badge.innerHTML = frame.statusHtml;

		if (this.shouldRenderList()) {
			this.swapList(frame.listHtml);
			this.announce(frame.count);
		}

		if (frame.isTerminal) {
			this.source?.close();
			this.source = null;
		}
	}

	/** Page-1-only (ADR 0007): no list swap on a filtered view or page 2+. */
	private shouldRenderList(): boolean {
		const params = new URLSearchParams(location.search);
		const page = params.get("page");
		if (page !== null && page !== "1") return false;
		if (params.get("type")) return false;
		return true;
	}

	private swapList(listHtml: string): void {
		const current = document.getElementById("results-list");
		if (!current) return;
		const template = document.createElement("template");
		template.innerHTML = listHtml.trim();
		const next = template.content.firstElementChild;
		if (!(next instanceof HTMLElement)) return;
		current.replaceWith(next);
		if (!this.reducedMotion()) {
			next.classList.add("results-updated");
			window.setTimeout(
				() => next.classList.remove("results-updated"),
				ENTRANCE_MS,
			);
		}
	}

	private announce(count: number): void {
		this.live.textContent =
			count === 1 ? "1 result so far" : `${count} results so far`;
	}

	private reducedMotion(): boolean {
		return (
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
		);
	}
}

if (!customElements.get("bb-result-stream")) {
	customElements.define("bb-result-stream", BbResultStream);
}
