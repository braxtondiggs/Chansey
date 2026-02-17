export class ColumnNumericTransformer {
  to(data: number): number {
    return data;
  }
  from(data: string | null): number | null {
    if (data === null) return null;
    return parseFloat(data);
  }
}
