import { ModelManager } from '../src/openrouter/modelManager.js';

async function run() {
  console.log('[TEST] Testing OpenRouter Model Dynamic Discovery...');
  const manager = ModelManager.getInstance();
  await manager.refreshModels();

  const textModels = manager.getTextModels();
  const visionModels = manager.getVisionModels();

  console.log(`\nAvailable Free Text Models (${textModels.length}):`);
  textModels.slice(0, 8).forEach((m, idx) => console.log(`  ${idx + 1}. ${m}`));

  console.log(`\nAvailable Free Vision Models (${visionModels.length}):`);
  visionModels.slice(0, 5).forEach((m, idx) => console.log(`  ${idx + 1}. ${m}`));

  if (textModels.length > 0 && visionModels.length > 0) {
    console.log('\n[PASS] OpenRouter Free Model Discovery test passed.');
  } else {
    console.error('\n[FAIL] No free models found.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});

