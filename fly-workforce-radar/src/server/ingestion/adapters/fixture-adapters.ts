import type {
  CaptureAdapter,
  CaptureAdapterRequest,
  CapturedResource,
} from "../../../domain/ingestion";
import type { CaptureMethod } from "../../../domain/source";

export type FixtureResource = Omit<CapturedResource, "capturedAt"> & { capturedAt?: Date };

abstract class FixtureCaptureAdapter implements CaptureAdapter {
  abstract readonly id: string;

  constructor(
    private readonly fixtures: ReadonlyMap<string, FixtureResource>,
    private readonly allowedMethods: ReadonlySet<CaptureMethod>,
    private readonly clock: () => Date,
  ) {}

  supports(method: CaptureMethod): boolean {
    return this.allowedMethods.has(method);
  }

  async capture(request: CaptureAdapterRequest): Promise<CapturedResource> {
    const fixture = this.fixtures.get(request.target);
    if (!fixture) throw new Error(`Fixture target not found: ${request.target}`);
    return { ...fixture, capturedAt: fixture.capturedAt ?? this.clock() };
  }
}

export class StructuredFixtureCaptureAdapter extends FixtureCaptureAdapter {
  readonly id = "structured-fixture";
}

export class CorporateCareersHtmlFixtureAdapter extends FixtureCaptureAdapter {
  readonly id = "corporate-careers-html-fixture";
}
