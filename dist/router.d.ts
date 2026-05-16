import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpConnector } from "./connector.js";
import type { RouterConfig } from "./types.js";
export declare function createRouterServer(connector: McpConnector, config: RouterConfig): McpServer;
export declare function createPassthroughServer(connector: McpConnector): Server;
//# sourceMappingURL=router.d.ts.map