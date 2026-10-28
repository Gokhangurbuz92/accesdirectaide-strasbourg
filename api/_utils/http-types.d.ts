// NOTE: These are intentionally permissive types used in JSDoc annotations for
// JS/JSX files under strict `checkJs`. They exist to avoid implicit-any (TS7006/
// TS7031) while not adding new strict errors (e.g. “possibly undefined”) across
// the codebase.

export type ApiRequest = {
  method: string;
  url: string;
  headers: Record<string, any>;
  query: Record<string, any>;
  body: any;
  cookies: Record<string, any>;
  [key: string]: any;
};

export type ApiResponse = {
  statusCode: number;
  getHeader: (name: string) => any;
  setHeader: (name: string, value: any) => any;
  set: (name: string, value: any) => any;
  writeHead: (statusCode: number, headers?: any) => any;
  end: (...args: any[]) => any;
  status: (code: number) => ApiResponse;
  json: (body: any) => any;
  send: (body: any) => any;
  redirect: (codeOrUrl: any, url?: any) => any;
  [key: string]: any;
};

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => any | Promise<any>;
