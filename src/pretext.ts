import { layout, prepare } from "@chenglou/pretext";
import type { PreparedText, PrepareOptions } from "@chenglou/pretext";

type Resolvable<TItem, TValue> =
  | TValue
  | ((index: number, item: TItem) => TValue);

export interface PretextEstimateSizeOptions<TItem> {
  getText: (item: TItem, index: number) => string;
  font: Resolvable<TItem, string>;
  width: Resolvable<TItem, number>;
  lineHeight: Resolvable<TItem, number>;
  paddingBlock?: Resolvable<TItem, number>;
  minSize?: Resolvable<TItem, number>;
  maxSize?: Resolvable<TItem, number>;
  fallbackSize?: Resolvable<TItem, number>;
  prepareOptions?: Resolvable<TItem, PrepareOptions | undefined>;
  maxCacheEntries?: number;
  onMeasureError?: (error: unknown, item: TItem, index: number) => void;
}

export type { PrepareOptions as PretextPrepareOptions };

export function createPretextEstimateSize<TItem>(
  options: PretextEstimateSizeOptions<TItem>
): (index: number, item: TItem) => number {
  const cache = new Map<string, PreparedText>();
  const maxCacheEntries = Math.max(0, options.maxCacheEntries ?? 1000);

  return (index, item) => {
    const width = Math.max(0, resolveRequired(options.width, index, item));
    const lineHeight = Math.max(
      0,
      resolveRequired(options.lineHeight, index, item)
    );
    const paddingBlock = Math.max(
      0,
      resolve(options.paddingBlock, index, item) ?? 0
    );
    const fallbackSize =
      resolve(options.fallbackSize, index, item) ??
      Math.max(lineHeight, 1) + paddingBlock;

    if (width <= 0 || lineHeight <= 0) {
      return fallbackSize;
    }

    const text = options.getText(item, index);
    const font = resolveRequired(options.font, index, item);
    const prepareOptions = resolve(options.prepareOptions, index, item);

    try {
      const prepared = getPreparedText(
        cache,
        maxCacheEntries,
        text,
        font,
        prepareOptions
      );
      const measuredSize = layout(prepared, width, lineHeight).height + paddingBlock;
      return Math.ceil(
        clamp(
          measuredSize,
          resolve(options.minSize, index, item),
          resolve(options.maxSize, index, item)
        )
      );
    } catch (error) {
      options.onMeasureError?.(error, item, index);
      return fallbackSize;
    }
  };
}

function getPreparedText(
  cache: Map<string, PreparedText>,
  maxCacheEntries: number,
  text: string,
  font: string,
  options: PrepareOptions | undefined
): PreparedText {
  if (maxCacheEntries === 0) {
    return prepare(text, font, options);
  }

  const key = createPreparedTextCacheKey(text, font, options);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const prepared = prepare(text, font, options);
  cache.set(key, prepared);

  if (cache.size > maxCacheEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  return prepared;
}

function createPreparedTextCacheKey(
  text: string,
  font: string,
  options: PrepareOptions | undefined
): string {
  return [
    font,
    options?.whiteSpace ?? "",
    options?.wordBreak ?? "",
    options?.letterSpacing ?? "",
    text
  ].join("\u0000");
}

function resolve<TItem, TValue>(
  value: Resolvable<TItem, TValue> | undefined,
  index: number,
  item: TItem
): TValue | undefined {
  return typeof value === "function"
    ? (value as (index: number, item: TItem) => TValue)(index, item)
    : value;
}

function resolveRequired<TItem, TValue>(
  value: Resolvable<TItem, TValue>,
  index: number,
  item: TItem
): TValue {
  return typeof value === "function"
    ? (value as (index: number, item: TItem) => TValue)(index, item)
    : value;
}

function clamp(
  value: number,
  min: number | undefined,
  max: number | undefined
): number {
  const minValue = min === undefined ? -Infinity : min;
  const maxValue = max === undefined ? Infinity : max;
  return Math.min(Math.max(value, minValue), maxValue);
}
