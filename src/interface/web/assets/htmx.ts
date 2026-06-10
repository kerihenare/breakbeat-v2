// Bundles htmx for the server-rendered pages (chip filtering + paginator region
// swaps on the Result page). Imported for its side effect: it attaches `htmx` to
// window and processes `hx-*` attributes. Served at /static/htmx.js.
import "htmx.org";
