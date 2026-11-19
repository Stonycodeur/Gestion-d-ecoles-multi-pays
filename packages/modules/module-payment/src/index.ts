import type { HookHandler } from '../../../shared/src/modules.ts';
import { applyDiscounts, splitInstallments } from '../../../shared/src/payment.ts';
import type { Discount } from '../../../shared/src/payment.ts';

/** onStudentCreated: computes the enrolment invoice (discounts + installment schedule) from the fee plan of the level.
 *  The module only COMPUTES; the core persists the invoice (the module never touches the database). */
export const handlers: Record<string, HookHandler> = {
  planInvoice: (p: { feePlan?: { amount_minor: number; installments: number; first_due_on: string }; discounts?: Discount[] }) => {
    if (!p.feePlan) return { invoice: null };
    const { discountMinor, netMinor } = applyDiscounts(p.feePlan.amount_minor, p.discounts ?? []);
    return { invoice: { gross_minor: p.feePlan.amount_minor, discount_minor: discountMinor, net_minor: netMinor,
      installments: splitInstallments(netMinor, p.feePlan.installments, p.feePlan.first_due_on) } };
  },
};
