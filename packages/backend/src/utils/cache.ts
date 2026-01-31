/**
 * Caching Utilities
 * 
 * Multi-layer caching system for performance optimization.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttl: number = 3600000): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export class CacheManager {
  private l1Cache: LRUCache<any>;

  constructor(maxSize: number = 1000) {
    this.l1Cache = new LRUCache(maxSize);
  }

  get<T>(key: string): T | undefined {
    return this.l1Cache.get(key);
  }

  set<T>(key: string, value: T, ttl: number = 3600000): void {
    this.l1Cache.set(key, value, ttl);
  }

  delete(key: string): void {
    this.l1Cache.delete(key);
  }

  clear(): void {
    this.l1Cache.clear();
  }
}
