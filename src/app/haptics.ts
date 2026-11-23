/** Short vibrations on phones that support them (Android browsers; iPhone Safari ignores this). */
export function buzz(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive !== false) navigator.vibrate(pattern);
  } catch {
    /* not allowed here */
  }
}
