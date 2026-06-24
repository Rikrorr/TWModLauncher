declare module "luaparse" {
  interface LuaAST {
    body: Array<{
      type: string;
      [key: string]: unknown;
    }>;
  }
  function parse(code: string, options?: Record<string, unknown>): LuaAST;
  export = { parse };
}
