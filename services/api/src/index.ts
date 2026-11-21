/**
 * @file services/api/src/index.ts
 * Sovra Modular API Gateway Service
 */

export { dispatchApiRequest } from './routes/index.js';
export { authController } from './controllers/auth.controller.js';
export { chatController } from './controllers/chat.controller.js';
export { socialController } from './controllers/social.controller.js';
export { telemetryController } from './controllers/telemetry.controller.js';
export { walletController } from './controllers/wallet.controller.js';
export { securityMiddleware } from './middleware/security.middleware.js';
export { authMiddleware } from './middleware/auth.middleware.js';
export { DecoupledApiServer, type ApiServerOptions } from './server.js';
export { ConsensusMonitor, type ValidatorStatus, type ConsensusAlert, type ConsensusHealthSummary } from './monitoring/consensus-monitor.js';
export { SecretRotationManager, type SecretVersion } from './monitoring/secret-rotation.js';
export { SecurityEventCollector, securityEventCollector, type SecurityEvent, type SecuritySeverity, type SecurityCategory } from './monitoring/security-events.js';
