export {};

declare global {
  interface MapConstructor {
    new(entries: Array<Array<string | object>>): Map<string, object>;
  }
}
