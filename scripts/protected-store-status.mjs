#!/usr/bin/env node
// R46 — prints the ProtectedStore driver state of the current environment (api/lib/protected-store/CONTRACT.md). Never prints a value.
import { protectedStoreStatus } from '../api/lib/protected-store/index.js';

const s = protectedStoreStatus(process.env);
console.log(JSON.stringify(s));
process.exitCode = s.available ? 0 : 3;
