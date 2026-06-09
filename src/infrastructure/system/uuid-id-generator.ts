import { uuidv7 } from "uuidv7";
import type { IdGenerator } from "../../application/ports/id-generator.port";

/** App-minted UUIDv7 — time-sortable and index-friendly (Foundation design). */
export class UuidIdGenerator implements IdGenerator {
	uuidv7(): string {
		return uuidv7();
	}
}
