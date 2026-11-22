import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OidcConfig } from './oidc-config';
import { Public } from './auth.guard';
import type { CoreRequest } from './request-context';
import type { RoleCode } from '@ecolemanager/shared';

@Controller()
export class AuthController {
  private readonly oidc = new OidcConfig();
  constructor(private readonly auth: AuthService) {}

  /** Which sign-in the apps must use. Public: contains no secret (public PKCE clients only). */
  @Public() @Get('auth/config')
  config() { return this.oidc.get(); }

  /** Sandbox only (AUTH_MODE=sandbox, non-production). Real deployments use Keycloak OIDC + PKCE. */
  @Public() @Post('auth/sandbox/token')
  async token(@Body() b: { sub: string; role: RoleCode; tenant: string; class_ids?: string[]; child_ids?: string[]; student_id?: string }) {
    return { access_token: await this.auth.issueSandbox(b), token_type: 'Bearer', expires_in: 900 };
  }

  @Get('me')
  me(@Req() req: CoreRequest) { return { principal: req.principal, tenant: req.tenantSlug ?? null }; }
}
