import {
  runWs2R1Seed,
} from './seed-strasbourg.mjs';

try {
  runWs2R1Seed();
} catch (error) {
  const code =
    error?.code ||
    error?.message ||
    'WS2_R1_SEED_FAILED';

  console.error(code);
  process.exitCode = 1;
}
