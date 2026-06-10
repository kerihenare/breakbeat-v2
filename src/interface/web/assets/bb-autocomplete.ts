import { html, LitElement, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";

type Suggestion = {
	brandId: string | null;
	name: string;
	domain: string | null;
};

const DEBOUNCE_MS = 180;

/**
 * `<bb-autocomplete>` — the homepage input-time disambiguation island.
 *
 * Progressive enhancement: it wraps the server-rendered `<form>` (which submits
 * a bare `query` and works with no JS). When mounted it turns the text input
 * into an ARIA combobox backed by `GET /brand-search`, rendering a keyboard-
 * navigable listbox of brand options plus an explicit "search by name" option
 * (the name-only proceed). Picking a brand fills the hidden `domain`/`brandId`
 * fields (→ `picked` anchor) and submits; the name-only option clears them and
 * submits the typed text (→ `name_only`); a typed domain just submits
 * (→ `url_provided`). The UI never re-ranks BrandFetch's hits.
 *
 * The listbox is rendered into a dedicated child `<ul>` (the Lit render root) so
 * Lit never overwrites the slotted form, and the combobox input + listbox share
 * one light-DOM tree (so `aria-controls`/`aria-activedescendant` resolve).
 */
export class BbAutocomplete extends LitElement {
	static properties = {
		active: { state: true },
		open: { state: true },
		options: { state: true },
	};

	declare options: Suggestion[];
	declare active: number;
	declare open: boolean;

	private input: HTMLInputElement | null = null;
	private brandIdField: HTMLInputElement | null = null;
	private domainField: HTMLInputElement | null = null;
	private listHost = document.createElement("ul");
	private minChars = 2;
	private debounceTimer = 0;
	private inFlight: AbortController | null = null;
	private blurTimer = 0;

	constructor() {
		super();
		this.options = [];
		this.active = -1;
		this.open = false;
	}

	protected createRenderRoot(): HTMLElement {
		return this.listHost;
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.minChars = Number(this.dataset.minChars ?? "2") || 2;
		this.input = this.querySelector<HTMLInputElement>('input[name="query"]');
		this.brandIdField = this.querySelector<HTMLInputElement>(
			'input[name="brandId"]',
		);
		this.domainField = this.querySelector<HTMLInputElement>(
			'input[name="domain"]',
		);
		if (!this.input) return;

		this.listHost.id = "bb-ac-listbox";
		this.listHost.className = "bb-ac-list";
		this.listHost.setAttribute("role", "listbox");
		this.listHost.hidden = true;
		const wrap = this.input.parentElement ?? this;
		wrap.style.position = "relative";
		wrap.appendChild(this.listHost);

		this.input.setAttribute("role", "combobox");
		this.input.setAttribute("aria-autocomplete", "list");
		this.input.setAttribute("aria-controls", "bb-ac-listbox");
		this.input.setAttribute("aria-expanded", "false");
		this.input.setAttribute("autocomplete", "off");

		this.input.addEventListener("input", this.onInput);
		this.input.addEventListener("keydown", this.onKeydown);
		this.input.addEventListener("blur", this.onBlur);
		this.input.addEventListener("focus", this.onFocus);
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.input?.removeEventListener("input", this.onInput);
		this.input?.removeEventListener("keydown", this.onKeydown);
		this.input?.removeEventListener("blur", this.onBlur);
		this.input?.removeEventListener("focus", this.onFocus);
		window.clearTimeout(this.debounceTimer);
		window.clearTimeout(this.blurTimer);
		this.inFlight?.abort();
	}

	private readonly onInput = (): void => {
		// Typing invalidates any prior pick — fall back to the typed text.
		if (this.brandIdField) this.brandIdField.value = "";
		if (this.domainField) this.domainField.value = "";
		window.clearTimeout(this.debounceTimer);
		this.debounceTimer = window.setTimeout(
			() => this.fetchSuggestions(),
			DEBOUNCE_MS,
		);
	};

	private readonly onFocus = (): void => {
		if (this.options.length > 0 || this.hasQuery()) this.openList();
	};

	private readonly onBlur = (): void => {
		// Delay so a pointer click on an option lands before the list closes.
		this.blurTimer = window.setTimeout(() => this.closeList(), 120);
	};

	private hasQuery(): boolean {
		return (this.input?.value.trim().length ?? 0) >= this.minChars;
	}

	private async fetchSuggestions(): Promise<void> {
		const query = this.input?.value.trim() ?? "";
		if (query.length < this.minChars) {
			this.options = [];
			this.closeList();
			return;
		}
		this.inFlight?.abort();
		this.inFlight = new AbortController();
		try {
			const res = await fetch(`/brand-search?q=${encodeURIComponent(query)}`, {
				headers: { accept: "application/json" },
				signal: this.inFlight.signal,
			});
			if (!res.ok) return;
			this.options = (await res.json()) as Suggestion[];
			this.active = -1;
			this.openList();
		} catch {
			// Aborted or network error — the bare form still submits the typed text.
		}
	}

	private openList(): void {
		this.open = true;
		this.listHost.hidden = false;
		this.input?.setAttribute("aria-expanded", "true");
	}

	private closeList(): void {
		this.open = false;
		this.listHost.hidden = true;
		this.active = -1;
		this.input?.setAttribute("aria-expanded", "false");
		this.input?.removeAttribute("aria-activedescendant");
	}

	/** The total navigable rows: each brand option, then the name-only option. */
	private rowCount(): number {
		return this.options.length + (this.hasQuery() ? 1 : 0);
	}

	private readonly onKeydown = (event: KeyboardEvent): void => {
		const count = this.rowCount();
		if (event.key === "ArrowDown") {
			if (!this.open && count > 0) this.openList();
			this.active = count === 0 ? -1 : (this.active + 1) % count;
			this.syncActiveDescendant();
			event.preventDefault();
		} else if (event.key === "ArrowUp") {
			this.active = count === 0 ? -1 : (this.active - 1 + count) % count;
			this.syncActiveDescendant();
			event.preventDefault();
		} else if (event.key === "Enter") {
			if (this.open && this.active >= 0) {
				this.choose(this.active);
				event.preventDefault();
			}
			// Otherwise let the form submit the typed text normally.
		} else if (event.key === "Escape") {
			if (this.open) {
				this.closeList();
				event.preventDefault();
			}
		}
	};

	private syncActiveDescendant(): void {
		if (this.active < 0) {
			this.input?.removeAttribute("aria-activedescendant");
			return;
		}
		this.input?.setAttribute(
			"aria-activedescendant",
			`bb-ac-opt-${this.active}`,
		);
	}

	/** Apply the row at `index`: a brand → picked + submit; the trailing row → name-only + submit. */
	private choose(index: number): void {
		if (!this.input) return;
		const brand = this.options[index];
		if (brand) {
			this.input.value = brand.name;
			if (this.brandIdField) this.brandIdField.value = brand.brandId ?? "";
			if (this.domainField) this.domainField.value = brand.domain ?? "";
		} else {
			// The trailing "search by name" row — clear any pick, keep the typed text.
			if (this.brandIdField) this.brandIdField.value = "";
			if (this.domainField) this.domainField.value = "";
		}
		this.closeList();
		this.input.form?.requestSubmit();
	}

	render(): TemplateResult | typeof nothing {
		if (!this.open) return nothing;
		const typed = this.input?.value.trim() ?? "";
		return html`
			${repeat(
				this.options,
				(_o, i) => i,
				(option, i) => html`
					<li
						id="bb-ac-opt-${i}"
						role="option"
						class="bb-ac-option"
						aria-selected=${this.active === i ? "true" : "false"}
						@mousedown=${(e: Event) => {
							e.preventDefault();
							this.choose(i);
						}}
						@mousemove=${() => {
							this.active = i;
							this.syncActiveDescendant();
						}}
					>
						<span class="bb-ac-option__name">${option.name}</span>
						${
							option.domain
								? html`<span class="bb-ac-option__domain">${option.domain}</span>`
								: nothing
						}
					</li>
				`,
			)}
			${
				this.hasQuery()
					? html`<li
						id="bb-ac-opt-${this.options.length}"
						role="option"
						class="bb-ac-option bb-ac-option--name"
						aria-selected=${this.active === this.options.length ? "true" : "false"}
						@mousedown=${(e: Event) => {
							e.preventDefault();
							this.choose(this.options.length);
						}}
						@mousemove=${() => {
							this.active = this.options.length;
							this.syncActiveDescendant();
						}}
					>
						Search <strong>“${typed}”</strong> by name
					</li>`
					: nothing
			}
		`;
	}
}

if (!customElements.get("bb-autocomplete")) {
	customElements.define("bb-autocomplete", BbAutocomplete);
}
