// Runnability gate (FR-9/10, NFR-2/3): linkinator over the assembled bundle must report
// zero broken links - for ANY subset of done screens, including half-failed runs (failed
// targets are dead-stubs, never hrefs to missing files).

import { check } from 'linkinator';

export interface RunnableResult {
  passed: boolean;
  broken: string[];
}

export async function checkRunnable(outDir: string): Promise<RunnableResult> {
  const result = await check({ path: outDir, recurse: true });
  const broken = result.links.filter((l) => String(l.state) === 'BROKEN').map((l) => l.url);
  return { passed: result.passed, broken };
}
