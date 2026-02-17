/**
 * Removes all null-valued properties from an entity in-place.
 * Useful for cleaning TypeORM entities before returning them in API responses.
 */
export function stripNullProps<T extends object>(entity: T): T {
  const record = entity as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (record[key] === null) delete record[key];
  }
  return entity;
}
