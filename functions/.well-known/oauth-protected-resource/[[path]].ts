import { discoveryResponse } from '../../_lib/mcpDiscovery';

/** AI Connector OAuth discovery (RFC 9728) at the site root, where AI apps look for it: /.well-known/oauth-protected-resource
 *  and /.well-known/oauth-protected-resource/api/mcp. Public metadata only (functions/_lib/mcpServer.ts). */
export const onRequestGet = ({ request }: { request: Request }) => discoveryResponse(request, 'resource');
