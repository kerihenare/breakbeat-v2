/** App-minted, time-sortable, index-friendly Job identity (Foundation design). */
export interface IdGenerator {
	uuidv7(): string;
}

export const ID_GENERATOR = Symbol("IdGenerator");
