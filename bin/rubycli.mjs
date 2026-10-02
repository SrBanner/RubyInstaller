#!/usr/bin/env node
import { entry } from '../src/cli.mjs';
await entry(process.argv.slice(2));
