export function currencyFractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function majorToMinor(value: string | number, currency: string): number {
  return Math.round(Number(value) * 10 ** currencyFractionDigits(currency));
}

export function minorToMajor(value: number, currency: string): number {
  return value / 10 ** currencyFractionDigits(currency);
}
