/**
 * Stand-ins for a collection nothing has been added to yet. A field holds one of these until its
 * first write, so a bus that never uses a feature pays for the field and nothing more. Reads
 * behave as on any empty collection; a write throws, so the owner replaces the stand-in first.
 */
class EmptyMap extends Map<any, any> {
  public set(): never {
    throw new Error('Replace EMPTY_MAP with a new Map before writing to it');
  }
}

class EmptySet extends Set<any> {
  public add(): never {
    throw new Error('Replace EMPTY_SET with a new Set before writing to it');
  }
}

export const EMPTY_MAP: Map<any, any> = new EmptyMap();
export const EMPTY_SET: Set<any> = new EmptySet();
