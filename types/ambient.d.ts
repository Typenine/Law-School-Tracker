declare module 'pdf-parse' {
  const pdfParse: any;
  export default pdfParse;
}

declare module 'mammoth' {
  const mammoth: any;
  export default mammoth;
}

declare module 'pg' {
  export class Pool {
    constructor(config?: any);
    query: (...args: any[]) => Promise<any>;
    end: () => Promise<void>;
  }
}
