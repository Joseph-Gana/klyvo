import healthHandler from '../../server/handlers/health';
import { withApiSecurityHeaders } from '../../server/lib/securityHeaders';

export default withApiSecurityHeaders(healthHandler);
