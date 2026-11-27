export const EMBED_SIZE: number;
export const MODEL_FILE: string;
export const MODEL_URL: string;
export function toInput(rgba: Uint8ClampedArray | Uint8Array): Float32Array;
export function pickVector(outputs: Record<string, { dims: readonly number[]; data: unknown }>): Float32Array;
export function quantize(v: Float32Array): Int8Array;
