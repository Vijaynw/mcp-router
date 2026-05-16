import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpConnector } from "./connector.js";
import type { RouterConfig } from "./types.js";
export declare function createDelegatedServer(connector: McpConnector, config: RouterConfig): Server;
export declare function createSmartServer(connector: McpConnector, config: RouterConfig): Server;
export declare function createPassthroughServer(connector: McpConnector): Server;
export declare function createRouterServer(connector: McpConnector, config: RouterConfig): McpServer;
//# sourceMappingURL=router.d.ts.map