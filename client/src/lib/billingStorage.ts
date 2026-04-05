/**
 * Billing state persistence via localStorage.
 * Saves and restores the billing wizard state so navigating away and back
 * doesn't reset the loaded tasks, selected items, and line items.
 *
 * v3: Added cachedTasks to persist the full task rows from the Breezeway API,
 * so the table is fully restored (not just selection IDs) when navigating back.
 */

const BILLING_STORAGE_KEY = "wand_billing_state_v3";

export interface BreezewayTaskCached {
  id: number;
  name: string;
  home_id: number;
  type_department?: string;
  type_priority?: string;
  type_task_status?: { code: string; name: string; stage: string };
  scheduled_date?: string;
  created_at?: string;
  assignments?: Array<{ id: number; assignee_id: number; name: string; type_task_user_status: string }>;
  created_by?: { id: number; name: string };
}

export interface BillingPersistedState {
  step: number;
  startDate: string;
  endDate: string;
  department: string;
  status: string;
  propertyFilter: string;
  selectedTags: string[];
  hasFetched: boolean;
  selectedTaskIds: string[];
  /** Full task rows from the Breezeway API — persisted so the table is restored on navigation */
  cachedTasks: BreezewayTaskCached[];
  lineItems: Array<{
    breezewayTaskId: string;
    breezewayTaskName: string;
    propertyId: string;
    propertyName: string;
    description: string;
    quantity: number;
    unitPrice: string;
    amount: string;
    isCustom?: boolean;
  }>;
  billingResults: Array<{
    ownerId: string;
    ownerName: string;
    method: string;
    success: boolean;
    amount: string;
    error?: string;
    paymentIntentId?: string;
    invoiceId?: string;
    invoiceUrl?: string;
  }>;
  fetchedFilters: {
    status?: string;
    startDate?: string;
    endDate?: string;
    propertyTags?: string[];
  } | null;
}

export function loadBillingState(): BillingPersistedState | null {
  try {
    const raw = localStorage.getItem(BILLING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BillingPersistedState;
    // Ensure cachedTasks always exists (for migration from v2)
    if (!parsed.cachedTasks) parsed.cachedTasks = [];
    return parsed;
  } catch {
    return null;
  }
}

export function saveBillingState(state: BillingPersistedState): void {
  try {
    localStorage.setItem(BILLING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors silently
  }
}

export function clearBillingState(): void {
  try {
    localStorage.removeItem(BILLING_STORAGE_KEY);
    // Also clear old v2 key
    localStorage.removeItem("wand_billing_state_v2");
  } catch {
    // ignore
  }
}
