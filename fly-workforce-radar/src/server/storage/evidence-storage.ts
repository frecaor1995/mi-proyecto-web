export interface EvidenceStorage {
  put(contentHash: string, payload: Uint8Array, contentType?: string): Promise<string>;
  get(reference: string): Promise<Uint8Array | null>;
}

interface StoredPayload {
  bytes: Uint8Array;
  contentType?: string;
}

export class InMemoryEvidenceStorage implements EvidenceStorage {
  readonly #payloads = new Map<string, StoredPayload>();

  async put(contentHash: string, payload: Uint8Array, contentType?: string): Promise<string> {
    const reference = `memory://sha256/${contentHash}`;
    const existing = this.#payloads.get(reference);

    if (existing && !Buffer.from(existing.bytes).equals(Buffer.from(payload))) {
      throw new Error("Content hash collision detected");
    }

    this.#payloads.set(reference, { bytes: Uint8Array.from(payload), contentType });
    return reference;
  }

  async get(reference: string): Promise<Uint8Array | null> {
    const stored = this.#payloads.get(reference);
    return stored ? Uint8Array.from(stored.bytes) : null;
  }
}
