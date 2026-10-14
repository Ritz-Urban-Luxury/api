import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { VehicleColour } from '../database/schemas/vehicle-settings.schema';

/** Lowercase letters and digits, e.g. "Mercedes-Benz" → "mercedesbenz". Same as the logo slug. */
export const toVehicleSlug = (name = '') =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Earliest year the driver app offers, and the default "from year" for imported models. */
export const EARLIEST_VEHICLE_YEAR = 2003;

/**
 * The makes and models the driver app shipped with before the list came from the API.
 * Seeded into the catalogue once, the first time the API starts with this code.
 */
export const STARTER_CATALOGUE: Record<string, string[]> = {
  Acura: ['MDX', 'RDX', 'TL', 'TLX'],
  Audi: ['A3', 'A4', 'A6', 'Q3', 'Q5', 'Q7'],
  BMW: ['3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X6'],
  Chevrolet: ['Aveo', 'Cruze', 'Equinox', 'Tahoe', 'Traverse'],
  Ford: ['Edge', 'Escape', 'Explorer', 'Focus', 'Fusion'],
  Honda: ['Accord', 'City', 'Civic', 'Crosstour', 'CR-V', 'Odyssey', 'Pilot'],
  Hyundai: ['Accent', 'Elantra', 'Santa Fe', 'Sonata', 'Tucson'],
  Infiniti: ['FX35', 'Q50', 'QX50', 'QX60', 'QX80'],
  Kia: ['Cerato', 'Optima', 'Picanto', 'Rio', 'Sorento', 'Sportage'],
  'Land Rover': [
    'Defender',
    'Discovery',
    'Range Rover',
    'Range Rover Evoque',
    'Range Rover Sport',
  ],
  Lexus: ['ES', 'GX', 'IS', 'LS', 'LX', 'NX', 'RX'],
  Mazda: ['CX-3', 'CX-5', 'CX-9', 'Mazda 3', 'Mazda 6'],
  'Mercedes-Benz': [
    'A-Class',
    'C-Class',
    'E-Class',
    'GLA',
    'GLC',
    'GLE',
    'S-Class',
  ],
  Mitsubishi: ['ASX', 'Lancer', 'Outlander', 'Pajero'],
  Nissan: [
    'Almera',
    'Altima',
    'Juke',
    'Maxima',
    'Murano',
    'Pathfinder',
    'Sentra',
    'X-Trail',
  ],
  Peugeot: ['206', '301', '307', '308', '406', '508'],
  Toyota: [
    '4Runner',
    'Avalon',
    'Avensis',
    'Camry',
    'Corolla',
    'Highlander',
    'Land Cruiser',
    'Prado',
    'RAV4',
    'Sienna',
    'Venza',
    'Yaris',
  ],
  Volkswagen: ['Golf', 'Jetta', 'Passat', 'Tiguan', 'Touareg'],
};

/** The colours the driver app shipped with; seeded with the settings, then admins edit them. */
export const DEFAULT_VEHICLE_COLOURS: VehicleColour[] = (
  [
    ['Black', '#111111'],
    ['White', '#ffffff'],
    ['Silver', '#c0c0c0'],
    ['Grey', '#808080'],
    ['Blue', '#1f4e9e'],
    ['Red', '#c62828'],
    ['Green', '#2e7d32'],
    ['Gold', '#d4af37'],
    ['Beige', '#d9c8a9'],
    ['Brown', '#6d4c41'],
    ['Burgundy', '#800020'],
    ['Champagne', '#f7e7ce'],
    ['Orange', '#ef6c00'],
    ['Purple', '#6a1b9a'],
    ['Yellow', '#f9d71c'],
  ] as const
).map(([label, hex]) => ({ label, value: label.toLowerCase(), hex }));

const DEFAULT_HEX = new Map(
  DEFAULT_VEHICLE_COLOURS.map((colour) => [colour.value, colour.hex]),
);

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

export type VehicleOptions = {
  manufacturers: {
    name: string;
    slug: string;
    logoUrl: string | null;
    models: { name: string; fromYear: number }[];
  }[];
  colours: VehicleColour[];
  allowOther: boolean;
};

type CatalogueRow = { manufacturer: string; brand: string; year: number };

@Injectable()
export class VehicleOptionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VehicleOptionsService.name);

  constructor(private readonly db: DatabaseService) {}

  /** Seeds the catalogue and colours on startup, without blocking it if the seed fails. */
  async onApplicationBootstrap() {
    try {
      const result = await this.seedOnce();
      if (result.seeded) {
        this.logger.log(`Seeded vehicle catalogue with ${result.added} models`);
      }
    } catch (error) {
      this.logger.warn(
        `Vehicle catalogue seed failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Adds the starter makes and models and the default colours, once. Claims the seed
   * atomically so two API instances starting together don't both run it.
   */
  async seedOnce(): Promise<{ seeded: boolean; added: number }> {
    await this.getSettings(); // creates the settings (with default colours) if missing
    const claimed = await this.db.vehicleSettings.findOneAndUpdate(
      { key: 'default', catalogueSeededAt: null },
      { $set: { catalogueSeededAt: new Date() } },
      { new: true },
    );
    if (!claimed) return { seeded: false, added: 0 };
    const { added } = await this.importStarterCatalogue();
    return { seeded: true, added };
  }

  /**
   * Turns catalogue rows (one per manufacturer + model + year) and logos into the list
   * drivers pick from: manufacturer → logo → models, each model with the earliest
   * accepted year. Rows that differ only in spelling ("Mercedes Benz") are merged.
   */
  static groupCatalogue(
    rows: CatalogueRow[],
    logos: { slug: string; logoUrl: string }[],
  ): VehicleOptions['manufacturers'] {
    const logoBySlug = new Map(logos.map((logo) => [logo.slug, logo.logoUrl]));
    const groups = new Map<
      string,
      { name: string; models: Map<string, { name: string; fromYear: number }> }
    >();

    rows.forEach((row) => {
      const slug = toVehicleSlug(row.manufacturer);
      const modelSlug = toVehicleSlug(row.brand);
      if (!slug || !modelSlug) return;
      const group = groups.get(slug) ?? {
        name: row.manufacturer.trim(),
        models: new Map(),
      };
      const existing = group.models.get(modelSlug);
      const year = Number.isFinite(row.year) ? row.year : EARLIEST_VEHICLE_YEAR;
      group.models.set(modelSlug, {
        name: existing?.name ?? row.brand.trim(),
        fromYear: Math.min(existing?.fromYear ?? year, year),
      });
      groups.set(slug, group);
    });

    return [...groups.entries()]
      .map(([slug, group]) => ({
        name: group.name,
        slug,
        logoUrl: logoBySlug.get(slug) ?? null,
        models: [...group.models.values()].sort((a, b) =>
          a.name.localeCompare(b.name, 'en', { numeric: true }),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Everything the vehicle step of driver onboarding needs, in one request. */
  async getOptions(): Promise<VehicleOptions> {
    const [rows, logos, settings] = await Promise.all([
      this.db.carBrands.find({ deleted: { $ne: true } }).lean(),
      this.db.carBrandLogos.find({ deleted: { $ne: true } }).lean(),
      this.getSettings(),
    ]);
    return {
      manufacturers: VehicleOptionsService.groupCatalogue(rows, logos),
      colours: settings.colours,
      allowOther: settings.allowOther,
    };
  }

  async getSettings(): Promise<{
    colours: VehicleColour[];
    allowOther: boolean;
  }> {
    const doc = await this.db.vehicleSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $setOnInsert: {
          key: 'default',
          colours: DEFAULT_VEHICLE_COLOURS,
          allowOther: true,
        },
      },
      { new: true, upsert: true },
    );
    return {
      colours: (doc.colours ?? []).map(({ label, value, hex }) => ({
        label,
        value,
        // Colours saved before swatches existed borrow the default shade if there is one.
        ...(hex ?? DEFAULT_HEX.get(value)
          ? { hex: hex ?? DEFAULT_HEX.get(value) }
          : {}),
      })),
      allowOther: doc.allowOther !== false,
    };
  }

  async updateSettings(input: {
    colours: { label: string; hex?: string }[];
    allowOther: boolean;
  }) {
    const seen = new Set<string>();
    const colours = input.colours
      .map(({ label, hex }) => ({
        label: label.trim(),
        hex: hex?.trim().toLowerCase(),
      }))
      .filter(({ label }) => Boolean(label))
      .map(({ label, hex }) => ({
        label,
        value: toVehicleSlug(label),
        ...(hex && HEX_PATTERN.test(hex) ? { hex } : {}),
      }))
      .filter(({ value }) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    if (!colours.length) {
      throw new BadRequestException('Add at least one colour');
    }
    await this.db.vehicleSettings.updateOne(
      { key: 'default' },
      { $set: { colours, allowOther: input.allowOther } },
      { upsert: true },
    );
    return this.getSettings();
  }

  /** Adds any starter makes and models that aren't in the catalogue yet. */
  async importStarterCatalogue() {
    const rows = await this.db.carBrands
      .find({ deleted: { $ne: true } })
      .lean();
    const existing = new Set(
      rows.map(
        (row) =>
          `${toVehicleSlug(row.manufacturer)}:${toVehicleSlug(row.brand)}`,
      ),
    );
    const missing = Object.entries(STARTER_CATALOGUE).flatMap(
      ([manufacturer, models]) =>
        models
          .filter(
            (model) =>
              !existing.has(
                `${toVehicleSlug(manufacturer)}:${toVehicleSlug(model)}`,
              ),
          )
          .map((model) => ({
            manufacturer,
            brand: model,
            year: EARLIEST_VEHICLE_YEAR,
          })),
    );
    if (missing.length) await this.db.carBrands.insertMany(missing);
    return { added: missing.length };
  }

  /**
   * Renames a manufacturer everywhere it's spelt: its models and its logo, so they
   * keep matching.
   */
  async renameManufacturer(from: string, to: string) {
    const fromSlug = toVehicleSlug(from);
    const name = to.trim();
    const toSlug = toVehicleSlug(name);
    if (!fromSlug || !toSlug) {
      throw new BadRequestException('Enter a manufacturer name');
    }
    const rows = await this.db.carBrands
      .find({ deleted: { $ne: true } })
      .lean();
    if (fromSlug !== toSlug) {
      const modelClash = rows.some(
        (row) => toVehicleSlug(row.manufacturer) === toSlug,
      );
      const logoClash = await this.db.carBrandLogos.exists({
        slug: toSlug,
        deleted: { $ne: true },
      });
      if (modelClash || logoClash) {
        throw new ConflictException(
          `${name} already exists. Add the models to it instead.`,
        );
      }
    }

    const ids = rows
      .filter((row) => toVehicleSlug(row.manufacturer) === fromSlug)
      .map((row) => row._id);
    const [models] = await Promise.all([
      ids.length
        ? this.db.carBrands.updateMany(
            { _id: { $in: ids } },
            { $set: { manufacturer: name } },
          )
        : Promise.resolve({ modifiedCount: 0 }),
      this.db.carBrandLogos.updateOne(
        { slug: fromSlug, deleted: { $ne: true } },
        { $set: { name, slug: toSlug } },
      ),
    ]);
    return { name, modelsUpdated: models.modifiedCount ?? ids.length };
  }
}
