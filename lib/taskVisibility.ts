import type { Task } from './types';
import { lifecycleFromTags } from './taskMetadata';

export function isVisibleTask(task: Task) {
  return lifecycleFromTags(task.tags) === 'active';
}
