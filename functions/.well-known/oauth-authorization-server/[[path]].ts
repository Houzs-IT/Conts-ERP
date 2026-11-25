import { discoveryResponse } from '../../_lib/mcpDiscovery';

/** AI Connector OAuth discovery (RFC 8414) at the site root: /.well-known/oauth-authorization-server[/...]. Public
 *  metadata only (functions/_lib/mcpServer.ts). */
export const onRequestGet = ({ request }: { request: Request }) => discoveryResponse(request, 'server');
