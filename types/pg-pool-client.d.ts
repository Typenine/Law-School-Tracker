import 'pg';

declare module 'pg' {
  export interface PoolClient {
    query(text: string, values?: unknown[]): Promise<any>;
    release(): void;
  }
}
