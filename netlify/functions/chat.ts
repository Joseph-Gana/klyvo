import chatHandler from '../../server/handlers/chat';
import { withApiSecurityHeaders } from '../../server/lib/securityHeaders';

export default withApiSecurityHeaders(chatHandler);
