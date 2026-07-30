import { ProcessRunner } from './process-runner';

/**
 * @deprecated Use ProcessRunner — it handles every supported runtime.
 * Kept as an alias so existing imports keep working.
 */
export class NodeRunner extends ProcessRunner {}
