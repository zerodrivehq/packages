#!/usr/bin/env node

import { runRecoveryCli } from "./main.js";

process.exitCode = await runRecoveryCli(process.argv.slice(2));
