import { Module } from '@nestjs/common';
import { ConnectedAppsController, OAuthConsentController } from './connected-apps.controller.js';
import { ConnectedAppsService } from './connected-apps.service.js';

/** Consentimento e apps conectados do MCP (docs/14-mcp.md 3.1 e 3.4). */
@Module({
  controllers: [OAuthConsentController, ConnectedAppsController],
  providers: [ConnectedAppsService],
})
export class OAuthModule {}
