export {};

declare global {
  interface MapConstructor {
    new(entries: Array<Array<string | object>>): Map<any, any>;
  }
}
