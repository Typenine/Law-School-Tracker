export {};

declare global {
  interface MapConstructor {
    new(entries: Array<Array<unknown>>): Map<any, any>;
  }
}
