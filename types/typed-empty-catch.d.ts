export {};

declare global {
  interface Promise<T> {
    catch(onrejected: () => Record<string, never>): Promise<T>;
  }
}
