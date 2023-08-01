export class StringNumericTransformer {
  to(data: string): string {
    return data;
  }
  from(data: string): number {
    return parseFloat(data);
  }
}
