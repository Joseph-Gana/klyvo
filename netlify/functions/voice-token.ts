import voiceTokenHandler from '../../server/handlers/voice-token';
import { withApiSecurityHeaders } from '../../server/lib/securityHeaders';

export default withApiSecurityHeaders(voiceTokenHandler);
