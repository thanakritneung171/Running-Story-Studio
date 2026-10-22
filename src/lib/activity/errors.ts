export class ActivityImportError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unsupported_format'
      | 'malformed'
      | 'empty'
      | 'too_large'
      | 'no_data',
  ) {
    super(message);
    this.name = 'ActivityImportError';
  }
}
