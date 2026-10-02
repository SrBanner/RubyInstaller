#!/usr/bin/env node
import { entry } from '../src/cli.mjs';
await entry(['mcp', ...process.argv.slice(2)]);
