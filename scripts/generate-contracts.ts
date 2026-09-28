/**
 * Generates the JSON Schemas in `contracts/` from the Zod definitions.
 *
 * The Zod schemas are the single source of truth; these files are their
 * published form, so that a future companion process, importer, or MCP server
 * written in another language can validate the same shapes. `--check` fails
 * when the committed files have drifted, which is what CI runs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  browserEventSchema,
  checkpointSchema,
  contextPackSchema,
  contextRequestSchema,
  evidenceSchema,
  findingSchema,
  ingestReceiptSchema,
  pageSchema,
  reviewItemSchema,
  settingsSchema,
  threadMembershipSchema,
  threadSchema,
  visitSchema,
} from '@jevtabs/core-domain';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'contracts');

const BUNDLES: Record<string, Record<string, z.ZodType>> = {
  'events.schema.json': {
    BrowserEvent: browserEventSchema,
    IngestReceipt: ingestReceiptSchema,
  },
  'domain.schema.json': {
    Page: pageSchema,
    Visit: visitSchema,
    Thread: threadSchema,
    ThreadMembership: threadMembershipSchema,
    Evidence: evidenceSchema,
    Finding: findingSchema,
    Checkpoint: checkpointSchema,
    ReviewItem: reviewItemSchema,
  },
  'context-pack.schema.json': {
    ContextRequest: contextRequestSchema,
    ContextPack: contextPackSchema,
  },
  'settings.schema.json': {
    Settings: settingsSchema,
  },
};

function render(name: string, members: Record<string, z.ZodType>): string {
  const definitions: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(members)) {
    definitions[key] = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' });
  }
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://jevtabs.dev/contracts/${name}`,
    title: name.replace('.schema.json', ''),
    description:
      'Generated from the Zod definitions in @jevtabs/core-domain. Do not edit by hand; run `pnpm contracts:generate`.',
    $defs: definitions,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

const check = process.argv.includes('--check');
mkdirSync(outDir, { recursive: true });

let drifted = 0;
for (const [name, members] of Object.entries(BUNDLES)) {
  const target = join(outDir, name);
  const next = render(name, members);
  if (check) {
    let current: string;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // Missing file counts as drift: the contract was never published.
      current = '';
    }
    if (current !== next) {
      drifted += 1;
      console.error(`contracts drift: ${name} is out of date — run \`pnpm contracts:generate\``);
    }
  } else {
    writeFileSync(target, next);
    console.log(`wrote contracts/${name}`);
  }
}

if (check && drifted > 0) process.exit(1);
