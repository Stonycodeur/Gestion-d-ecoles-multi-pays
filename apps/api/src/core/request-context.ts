import type { Request } from 'express';
import type { Principal } from '@ecolemanager/shared';
export interface CoreRequest extends Request { tenantSlug?: string; principal?: Principal }
