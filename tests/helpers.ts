import { readFileSync } from 'node:fs';
import { parseActivity } from '../src/lib/activity/parse';

export const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
export const load = (name: string) => parseActivity(fixture(name), name, 'test_activity');
