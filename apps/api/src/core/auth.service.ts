import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import type { Principal, RoleCode } from '@ecolemanager/shared';

const ROLES: RoleCode[] = ['root_super_admin', 'tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian', 'visitor', 'inspector'];

export interface AuthContext { principal: Principal; tenantSlug?: string }

@Injectable()
export class AuthService {
  private get mode() { return process.env.AUTH_MODE ?? 'oidc'; }

  private sandboxKey(): Uint8Array {
    const s = process.env.SANDBOX_JWT_SECRET;
    if (!s || s.length < 32) throw new Error('SANDBOX_JWT_SECRET (>=32 chars) is required when AUTH_MODE=sandbox');
    return new TextEncoder().encode(s);
  }

  /** Dev/test only. Never mints a root token. Disabled in production. */
  async issueSandbox(input: { sub: string; role: RoleCode; tenant: string; class_ids?: string[]; child_ids?: string[]; student_id?: string }): Promise<string> {
    if (this.mode !== 'sandbox' || process.env.NODE_ENV === 'production') throw new UnauthorizedException('sandbox auth disabled');
    if (input.role === 'root_super_admin') throw new UnauthorizedException('root cannot be issued by sandbox');
    if (!ROLES.includes(input.role)) throw new UnauthorizedException('unknown role');
    return new SignJWT({ roles: [input.role], tenant: input.tenant, class_ids: input.class_ids, child_ids: input.child_ids, student_id: input.student_id })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(input.sub).setIssuedAt().setExpirationTime('15m').sign(this.sandboxKey());
  }

  async verify(token: string): Promise<AuthContext> {
    let payload: JWTPayload;
    try {
      if (this.mode === 'sandbox') {
        payload = (await jwtVerify(token, this.sandboxKey(), { algorithms: ['HS256'] })).payload;
      } else {
        const jwks = createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URI ?? ''));
        payload = (await jwtVerify(token, jwks, { issuer: process.env.OIDC_ISSUER, audience: process.env.OIDC_AUDIENCE })).payload;
      }
    } catch { throw new UnauthorizedException('invalid token'); }
    const roles = ((payload.roles as string[] | undefined) ?? []).filter((r): r is RoleCode => ROLES.includes(r as RoleCode));
    const isRoot = roles.includes('root_super_admin') && payload.is_root !== false;
    return {
      tenantSlug: payload.tenant as string | undefined,
      principal: {
        id: String(payload.sub), roles, isRoot, tenantId: (payload.tenant as string | undefined) ?? null,
        classIds: payload.class_ids as string[] | undefined, childIds: payload.child_ids as string[] | undefined, studentId: payload.student_id as string | undefined,
      },
    };
  }
}
